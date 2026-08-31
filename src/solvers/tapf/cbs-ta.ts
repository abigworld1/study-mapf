import type {
  Cell,
  MapfSolver,
  Scenario,
  SolverContext,
  SolverEvent,
  SolverOptions,
  SolverResult,
  SolverWarning,
  TimedPath,
} from "@/lib/model/types.js";
import { makespanOf, sumOfCosts } from "@/lib/model/conflicts.js";
import { cellEquals, isWalkable, manhattan } from "@/lib/model/grid.js";
import { validateScenario } from "@/lib/model/scenario.js";
import { hungarianMethod } from "@/lib/assignment/hungarian.js";
import { createTraceRecorder } from "../context.js";
import { checkLimits } from "../limits.js";
import { solveCbsVariant } from "../cbs/core.js";

interface TargetInfo {
  readonly id: string;
  readonly cell: Cell;
  readonly teamId?: string;
}

interface AssignmentModel {
  readonly targets: readonly TargetInfo[];
  readonly allowed: readonly (readonly boolean[])[];
}

interface ParkingAssignment {
  readonly agentId: string;
  readonly goal: Cell;
}

interface DerivedAssignment {
  readonly scenario: Scenario;
  readonly parking: readonly ParkingAssignment[];
}

type Assignment = readonly (number | null)[];
const MAX_ASSIGNMENTS = 10000;

export const cbsTaSolver: MapfSolver = {
  metadata: {
    id: "cbs-ta",
    displayName: "CBS-TA",
    originalName: "Conflict-Based Search with Target Assignment",
    category: "tapf",
    supports: ["tapf"],
    status: "runnable",
    fidelity: "educational",
    basedOnPaperIds: ["cbs-ta-aamas-2018"],
    implementationNote:
      "割当行列の候補を Hungarian 法で優先付けし、各候補を CBS で評価する教材実装です。論文の遅延 K-best search forest を、ブラウザ向けに決定的な候補列挙へ置き換えています。",
  },
  canSolve: (scenario) => {
    const hasAssignment = (scenario.assignment?.targets.length ?? 0) > 0;
    const hasTeams = (scenario.teams?.length ?? 0) > 0;
    return scenario.kind === "tapf" && hasAssignment !== hasTeams;
  },
  async solve(scenario, options, context) {
    return solveCbsTa(scenario, options, context);
  },
};

export async function solveCbsTa(
  scenario: Scenario,
  options: SolverOptions,
  context: SolverContext,
): Promise<SolverResult> {
  const startedAt = context.now();
  const recorder = createTraceRecorder(options);
  const warnings: SolverWarning[] = [];
  const emit = (event: SolverEvent) => {
    recorder.record(event);
    context.emit(event);
  };
  const limits = checkLimits(scenario, options);
  if (!limits.ok) return { ...limits.result!, objective: "sum-of-costs" };
  if (scenario.kind !== "tapf")
    return errorResult("unsupported-rules", "CBS-TA は TAPF にのみ対応します。");
  const problems = validateScenario(scenario);
  if (problems.length > 0) return errorResult("invalid-scenario", problems.join(" / "));
  const model = assignmentModel(scenario);
  if (!model) return errorResult("invalid-scenario", "割当行列または teams がありません。");
  if (scenario.rules.allowDiagonal) {
    return errorResult("unsupported-rules", "CBS-TA は 4 近傍 grid に対応します。");
  }

  const candidates = enumerateAssignments(model, scenario.agents.length);
  if (candidates.length > MAX_ASSIGNMENTS) {
    return errorResult(
      "invalid-scenario",
      `割当候補が ${candidates.length} 通りあり、上限 ${MAX_ASSIGNMENTS} を超えます。`,
    );
  }
  const ordered = orderByHungarian(candidates, model, scenario);
  warnings.push({
    code: "simplified-behavior",
    message:
      "CBS-TA は sum of costs を最小化します。CBM / tapf-baseline の makespan 最適解とは目的関数が異なるため、数値を直接比較しません。",
  });
  warnings.push({
    code: "simplified-behavior",
    message:
      "論文の K-best 割当 search forest を、候補数を制限した決定的列挙で再構成しています。全候補を評価できた場合だけ、この入力について SOC 最小を確認できます。",
  });

  const perRunOptions: SolverOptions = {
    ...options,
    timeoutMs: Math.max(50, Math.floor(options.timeoutMs / Math.max(1, ordered.length))),
    traceLevel: "off",
  };
  let best:
    | { result: SolverResult; assignment: Assignment; parking: readonly ParkingAssignment[] }
    | undefined;
  let expanded = 0;
  let evaluated = 0;
  for (const [index, assignment] of ordered.entries()) {
    if (context.signal.aborted) break;
    if (context.now() - startedAt >= options.timeoutMs) break;
    const derived = withAssignment(scenario, model, assignment);
    emit({
      type: "progress",
      ratio: (index + 1) / ordered.length,
      label: `割当 ${index + 1}/${ordered.length}`,
    });
    emit({ type: "create-ct-node", nodeId: `assignment-${index}`, cost: 0, constraintCount: 0 });
    const result = await solveCbsVariant(derived.scenario, perRunOptions, silentContext(context), {
      variant: "cbs",
      lowLevelWeight: 1,
      highLevelWeight: 1,
    });
    expanded += result.metrics.expandedNodes ?? 0;
    evaluated += 1;
    if (result.outcome !== "solved") continue;
    emit({
      type: "low-level-replan",
      agentId: scenario.agents[0]?.id ?? "",
      nodeId: `assignment-${index}`,
    });
    const cost = sumOfCosts(result.paths);
    if (
      !best ||
      cost < sumOfCosts(best.result.paths) ||
      (cost === sumOfCosts(best.result.paths) &&
        makespanOf(result.paths) < makespanOf(best.result.paths))
    ) {
      best = { result, assignment, parking: derived.parking };
      emit({ type: "update-incumbent", cost, iteration: index });
    }
  }
  if (!best) {
    const outcome = context.signal.aborted
      ? "aborted"
      : context.now() - startedAt >= options.timeoutMs
        ? "timeout"
        : "no-solution";
    return {
      outcome,
      paths: [],
      metrics: {
        sumOfCosts: 0,
        makespan: 0,
        runtimeMs: context.now() - startedAt,
        expandedNodes: expanded,
        generatedNodes: evaluated,
      },
      conflicts: [],
      failureReason: outcome === "no-solution" ? "search-exhausted" : "limit-exceeded",
      objective: "sum-of-costs",
      warnings,
      trace: recorder.events,
    };
  }
  if (evaluated < ordered.length) {
    warnings.push({
      code: "simplified-behavior",
      message: `${ordered.length} 候補のうち ${evaluated} 候補しか評価できなかったため、返した SOC が全体最適とは限りません。`,
    });
  }
  const final: SolverResult = {
    ...best.result,
    metrics: {
      ...best.result.metrics,
      runtimeMs: context.now() - startedAt,
      expandedNodes: expanded,
      generatedNodes: evaluated,
    },
    objective: "sum-of-costs",
    targetAssignments: targetAssignments(model, scenario, best.assignment),
    warnings: [
      ...warnings,
      ...(best.parking.length > 0 ? [parkingWarning(best.result.paths, best.parking)] : []),
      ...(best.result.warnings ?? []),
    ],
    trace: recorder.events,
  };
  emit({ type: "finish", result: final });
  return final;
}

function assignmentModel(scenario: Scenario): AssignmentModel | null {
  if (scenario.assignment) {
    return {
      targets: scenario.assignment.targets,
      allowed: scenario.assignment.allowed,
    };
  }
  if (!scenario.teams) return null;
  const targets: TargetInfo[] = [];
  for (const team of scenario.teams) {
    team.goals.forEach((cell, index) =>
      targets.push({ id: `${team.id}-target${index + 1}`, cell, teamId: team.id }),
    );
  }
  const allowed = scenario.agents.map((agent) => {
    const team = scenario.teams!.find((candidate) => candidate.agentIds.includes(agent.id));
    return targets.map((target) => target.teamId === team?.id);
  });
  return { targets, allowed };
}

function enumerateAssignments(model: AssignmentModel, agentCount: number): Assignment[] {
  const need = Math.min(agentCount, model.targets.length);
  const rows: Assignment[] = [];
  const current: (number | null)[] = Array.from({ length: agentCount }, () => null);
  const used = new Set<number>();
  function visit(row: number, assigned: number): void {
    if (rows.length > MAX_ASSIGNMENTS) return;
    if (row === agentCount) {
      if (assigned === need) rows.push([...current]);
      return;
    }
    const remainingRows = agentCount - row;
    if (assigned + remainingRows < need) return;
    for (let target = 0; target < model.targets.length; target += 1) {
      if (used.has(target) || !model.allowed[row]?.[target]) continue;
      used.add(target);
      current[row] = target;
      visit(row + 1, assigned + 1);
      used.delete(target);
      current[row] = null;
    }
    if (agentCount > model.targets.length) visit(row + 1, assigned);
  }
  visit(0, 0);
  return rows;
}

function orderByHungarian(
  candidates: readonly Assignment[],
  model: AssignmentModel,
  scenario: Scenario,
): Assignment[] {
  const costs = scenario.agents.map((agent, row) =>
    model.targets.map((target, column) =>
      model.allowed[row]?.[column] ? manhattan(agent.start, target.cell) : Number.POSITIVE_INFINITY,
    ),
  );
  const preferred = hungarianMethod(costs)?.assignment;
  if (!preferred) return [...candidates];
  const key = preferred.map((target) => target ?? -1).join(",");
  return [...candidates].sort((a, b) => {
    const ak = a.map((target) => target ?? -1).join(",");
    const bk = b.map((target) => target ?? -1).join(",");
    return (ak === key ? -1 : 0) - (bk === key ? -1 : 0) || ak.localeCompare(bk);
  });
}

function withAssignment(
  scenario: Scenario,
  model: AssignmentModel,
  assignment: Assignment,
): DerivedAssignment {
  const usedParking = new Set<string>();
  const targetCells = new Set(model.targets.map((target) => `${target.cell.x},${target.cell.y}`));
  const startCells = new Set(scenario.agents.map((agent) => `${agent.start.x},${agent.start.y}`));
  const parking: ParkingAssignment[] = [];
  const derivedScenario: Scenario = {
    ...scenario,
    kind: "one-shot-mapf",
    teams: undefined,
    assignment: undefined,
    agents: scenario.agents.map((agent, index) => {
      if (assignment[index] !== null && assignment[index] !== undefined) {
        return { ...agent, goal: model.targets[assignment[index]!]!.cell };
      }
      const goal = chooseParkingGoal(scenario, agent.start, targetCells, startCells, usedParking);
      parking.push({ agentId: agent.id, goal });
      return { ...agent, goal };
    }),
  };
  return { scenario: derivedScenario, parking };
}

function parkingWarning(
  paths: readonly TimedPath[],
  parking: readonly ParkingAssignment[],
): SolverWarning {
  const parkingIds = new Set(parking.map((entry) => entry.agentId));
  const parkingPaths = paths.filter((path) => parkingIds.has(path.agentId));
  const parkingSoc = sumOfCosts(parkingPaths);
  const parkingMoves = parkingPaths.reduce(
    (total, path) =>
      total +
      path.positions.slice(1).filter((position, index) => {
        const previous = path.positions[index];
        return previous !== undefined && !cellEquals(previous.cell, position.cell);
      }).length,
    0,
  );
  const totalSoc = sumOfCosts(paths);
  return {
    code: "simplified-behavior",
    message:
      `割当のない ${parking.length} 体（${parking.map((entry) => entry.agentId).join(", ")}）を、` +
      "他の agent の邪魔になりにくい空きセルへ退避させました。" +
      "CBS-TA 論文 p.2 の条件 (2) は全 agent が許された goal で終了することを要求するため、" +
      "goal を持たない agent はその定義の外です。" +
      "ここでは著者の libMultiRobotPlanning 参照実装（test_cbs_ta.py が (2,1) の終端を assert）に倣い、" +
      `退避を行います。退避の移動量は ${parkingMoves} 歩、退避 agent の到達時刻 ${parkingSoc} が SOC に含まれ、` +
      `SOC 内訳は target 側 ${totalSoc - parkingSoc} + 退避側 ${parkingSoc} = ${totalSoc} です。`,
  };
}

function chooseParkingGoal(
  scenario: Scenario,
  start: Cell,
  targetCells: ReadonlySet<string>,
  startCells: ReadonlySet<string>,
  used: Set<string>,
): Cell {
  // The paper does not define a no-potential-goal agent. This degree-first
  // parking rule is a browser-only deterministic extension; it is not inferred
  // from the reference implementation's internal tie-breaks.
  const candidates: Cell[] = [];
  for (let y = 0; y < scenario.map.height; y += 1) {
    for (let x = 0; x < scenario.map.width; x += 1) {
      const cell = { x, y };
      const key = `${x},${y}`;
      if (
        isWalkable(scenario.map, cell) &&
        !targetCells.has(key) &&
        !startCells.has(key) &&
        !used.has(key)
      ) {
        candidates.push(cell);
      }
    }
  }
  const degree = (cell: Cell) =>
    [
      { x: cell.x - 1, y: cell.y },
      { x: cell.x + 1, y: cell.y },
      { x: cell.x, y: cell.y - 1 },
      { x: cell.x, y: cell.y + 1 },
    ].filter((neighbor) => isWalkable(scenario.map, neighbor)).length;
  candidates.sort(
    (a, b) =>
      degree(a) - degree(b) || manhattan(start, a) - manhattan(start, b) || a.y - b.y || a.x - b.x,
  );
  const goal = candidates[0] ?? start;
  used.add(`${goal.x},${goal.y}`);
  return goal;
}

function targetAssignments(
  model: AssignmentModel,
  scenario: Scenario,
  assignment: Assignment,
): SolverResult["targetAssignments"] {
  return assignment.flatMap((targetIndex, agentIndex) => {
    if (targetIndex === null || targetIndex === undefined) return [];
    const target = model.targets[targetIndex];
    const agent = scenario.agents[agentIndex];
    if (!target || !agent) return [];
    return [
      {
        agentId: agent.id,
        ...(target.teamId ? { teamId: target.teamId } : {}),
        targetId: target.id,
        goal: target.cell,
      },
    ];
  });
}

function silentContext(context: SolverContext): SolverContext {
  return { ...context, emit: () => {} };
}

function errorResult(
  code: "unsupported-rules" | "invalid-scenario",
  message: string,
): SolverResult {
  return {
    outcome: "error",
    paths: [],
    metrics: { sumOfCosts: 0, makespan: 0, runtimeMs: 0 },
    conflicts: [],
    error: { code, message },
    failureReason: code === "unsupported-rules" ? "unsupported-rules" : "internal",
    objective: "sum-of-costs",
  };
}
