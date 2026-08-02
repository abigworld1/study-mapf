import type {
  Cell,
  Conflict,
  MapfSolver,
  Scenario,
  SolverContext,
  SolverEvent,
  SolverOptions,
  SolverResult,
  SolverWarning,
  TeamSpec,
  TimedPath,
} from "@/lib/model/types.js";
import { detectConflicts } from "@/lib/model/conflicts.js";
import { manhattan } from "@/lib/model/grid.js";
import { validateScenario } from "@/lib/model/scenario.js";
import { createTraceRecorder } from "../context.js";
import { checkLimits } from "../limits.js";
import { buildResult, checkAbort } from "../shared.js";
import { solveTeamByMinCostFlow, type TeamFlowConstraint } from "./team-flow.js";

interface CbmNode {
  readonly constraints: ReadonlyMap<string, readonly TeamFlowConstraint[]>;
  readonly paths: readonly TimedPath[];
}

export const cbmSolver: MapfSolver = {
  metadata: {
    id: "cbm",
    displayName: "CBM",
    originalName: "Conflict-Based Min-Cost-Flow",
    category: "tapf",
    supports: ["tapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    basedOnPaperIds: ["cbm-tapf-aamas-2016", "network-flow-mapf-2012"],
    implementationNote:
      "チームごとの匿名経路を時空間 min-cost max-flow で求め、チーム間の衝突を CBS 型に分岐して解消します。目的関数は makespan です。",
  },
  canSolve: (scenario) =>
    scenario.kind === "tapf" &&
    (scenario.teams?.length ?? 0) > 0 &&
    scenario.assignment === undefined,
  async solve(scenario, options, context) {
    return solveCbm(scenario, options, context);
  },
};

async function solveCbm(
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
  if (!limits.ok) return { ...limits.result!, objective: "makespan" };
  if (scenario.kind !== "tapf" || !scenario.teams || scenario.teams.length === 0) {
    return failure("unsupported-rules", "CBM は teams 形式の TAPF にのみ対応します。");
  }
  const problems = validateScenario(scenario);
  if (problems.length > 0) return failure("invalid-scenario", problems.join(" / "));
  if (scenario.rules.allowDiagonal || scenario.rules.forbidFollowing) {
    return failure(
      "unsupported-rules",
      "CBM の時空間フローは 4 近傍・following conflict 許可に対応します。",
    );
  }

  const teamByAgent = new Map<string, TeamSpec>();
  const startsByTeam = new Map<string, readonly Cell[]>();
  for (const team of scenario.teams) {
    const starts = team.agentIds.map(
      (id) => scenario.agents.find((agent) => agent.id === id)?.start,
    );
    if (starts.some((cell): cell is undefined => cell === undefined)) {
      return failure("invalid-scenario", `${team.id}: 開始位置が取得できません。`);
    }
    team.agentIds.forEach((id) => teamByAgent.set(id, team));
    startsByTeam.set(team.id, starts as readonly Cell[]);
  }
  let lower = 0;
  for (const team of scenario.teams) {
    for (const [index, agentId] of team.agentIds.entries()) {
      const start = startsByTeam.get(team.id)![index]!;
      const best = Math.min(...team.goals.map((goal) => manhattan(start, goal)));
      lower = Math.max(lower, best);
      emit({ type: "low-level-replan", agentId, nodeId: "root" });
    }
  }
  const maxHorizon = Math.min(
    options.maxHorizon,
    options.horizon ?? Math.max(64, lower + scenario.map.width * scenario.map.height),
  );
  let expanded = 0;
  let generated = 0;
  let conflictsDetected = 0;
  for (let horizon = lower; horizon <= maxHorizon; horizon += 1) {
    const root = planAll(new Map(), horizon);
    if (!root) continue;
    const open: CbmNode[] = [root];
    while (open.length > 0) {
      const stop = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
      if (stop !== "ok") return finish(stop, "limit-exceeded");
      const node = open.shift()!;
      expanded += 1;
      if (expanded > options.maxExpansions) return finish("node-limit", "limit-exceeded");
      generated += 1;
      const conflicts = detectConflicts(node.paths, scenario.rules);
      conflictsDetected += conflicts.length;
      emit({ type: "expand-node", state: { phase: "cbm", horizon, conflicts: conflicts.length } });
      if (conflicts.length === 0) {
        const result = buildResult(
          scenario,
          node.paths,
          context.now() - startedAt,
          expanded,
          "solved",
          {
            generatedNodes: generated,
            conflictsDetected,
            lowerBound: lower,
          },
        );
        const assignments = assignmentsFor(scenario.teams, node.paths);
        const final = {
          ...result,
          objective: "makespan" as const,
          targetAssignments: assignments,
          warnings: [
            ...warnings,
            {
              code: "simplified-behavior" as const,
              message:
                "CBM は makespan を最小化します。表示される sum of costs は最適性の対象ではありません。",
            },
          ],
          trace: recorder.events,
        };
        emit({ type: "finish", result: final });
        return final;
      }
      const conflict = conflicts[0]!;
      emit({ type: "detect-conflict", conflict });
      const teams = conflictingTeams(conflict, teamByAgent);
      for (const team of teams) {
        const constraint = constraintFor(conflict, team, teamByAgent);
        const nextConstraints = new Map(node.constraints);
        const previous = nextConstraints.get(team.id) ?? [];
        nextConstraints.set(team.id, [...previous, constraint]);
        emit({
          type: "add-constraint",
          constraint:
            constraint.kind === "vertex"
              ? {
                  kind: "vertex",
                  agentId: team.agentIds[0]!,
                  cell: constraint.cell!,
                  time: constraint.time,
                }
              : {
                  kind: "edge",
                  agentId: team.agentIds[0]!,
                  from: constraint.from!,
                  to: constraint.to!,
                  time: constraint.time,
                },
        });
        const planned = planAll(nextConstraints, horizon);
        if (planned) open.push(planned);
      }
    }
  }
  return finish("no-solution", "search-exhausted");

  function planAll(
    constraints: ReadonlyMap<string, readonly TeamFlowConstraint[]>,
    horizon: number,
  ): CbmNode | null {
    const paths: TimedPath[] = [];
    for (const team of scenario.teams!) {
      const result = solveTeamByMinCostFlow(
        scenario.map,
        team,
        startsByTeam.get(team.id)!,
        horizon,
        constraints.get(team.id) ?? [],
      );
      if (!result) return null;
      paths.push(...result.paths);
    }
    return { constraints, paths };
  }

  function finish(
    outcome: SolverResult["outcome"],
    reason: SolverResult["failureReason"],
  ): SolverResult {
    const result: SolverResult = {
      outcome,
      paths: [],
      metrics: {
        sumOfCosts: 0,
        makespan: 0,
        runtimeMs: context.now() - startedAt,
        expandedNodes: expanded,
        generatedNodes: generated,
        conflictsDetected,
      },
      conflicts: [],
      failureReason: reason,
      objective: "makespan",
      warnings,
      trace: recorder.events,
    };
    emit({ type: "finish", result });
    return result;
  }

  function failure(code: "unsupported-rules" | "invalid-scenario", message: string): SolverResult {
    return {
      outcome: "error",
      paths: [],
      metrics: { sumOfCosts: 0, makespan: 0, runtimeMs: context.now() - startedAt },
      conflicts: [],
      error: { code, message },
      failureReason: code === "unsupported-rules" ? "unsupported-rules" : "internal",
      objective: "makespan",
    };
  }
}

function conflictingTeams(conflict: Conflict, byAgent: ReadonlyMap<string, TeamSpec>): TeamSpec[] {
  const a = byAgent.get(conflict.agentA);
  const b = byAgent.get(conflict.agentB);
  if (!a) return b ? [b] : [];
  if (!b || a.id === b.id) return [a];
  return [a, b];
}

function constraintFor(
  conflict: Conflict,
  team: TeamSpec,
  byAgent: ReadonlyMap<string, TeamSpec>,
): TeamFlowConstraint {
  if (conflict.kind === "vertex")
    return { kind: "vertex", cell: conflict.cell, time: conflict.time };
  if (conflict.kind === "edge-swap") {
    const isA = byAgent.get(conflict.agentA)?.id === team.id;
    return {
      kind: "edge",
      from: isA ? conflict.from : conflict.to,
      to: isA ? conflict.to : conflict.from,
      time: conflict.time,
    };
  }
  return { kind: "vertex", cell: conflict.cell, time: conflict.time };
}

function assignmentsFor(
  teams: readonly TeamSpec[],
  paths: readonly TimedPath[],
): SolverResult["targetAssignments"] {
  const out: { agentId: string; teamId: string; goal: Cell }[] = [];
  for (const team of teams) {
    for (const agentId of team.agentIds) {
      const path = paths.find((candidate) => candidate.agentId === agentId);
      const goal = path?.positions[path.positions.length - 1]?.cell;
      if (goal) out.push({ agentId, teamId: team.id, goal });
    }
  }
  return out;
}
