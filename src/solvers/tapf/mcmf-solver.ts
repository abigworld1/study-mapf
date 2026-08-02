import type {
  Cell,
  Conflict,
  MapfSolver,
  Scenario,
  SolverContext,
  SolverOptions,
  SolverResult,
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

export const minCostMaxFlowSolver: MapfSolver = {
  metadata: {
    id: "min-cost-max-flow",
    displayName: "最小費用最大流",
    originalName: "Min-Cost Max-Flow",
    category: "tapf",
    supports: ["tapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    basedOnPaperIds: ["network-flow-mapf-2012", "cbm-tapf-aamas-2016"],
    implementationNote:
      "1 チーム TAPF（匿名 MAPF）を時空間ネットワークの最小費用最大流で解きます。複数チームの衝突解消は CBM が担当します。",
  },
  canSolve: (scenario) =>
    scenario.kind === "tapf" &&
    (scenario.teams?.length ?? 0) === 1 &&
    scenario.assignment === undefined,
  async solve(scenario, options, context) {
    return solveMcmf(scenario, options, context);
  },
};

async function solveMcmf(
  scenario: Scenario,
  options: SolverOptions,
  context: SolverContext,
): Promise<SolverResult> {
  const startedAt = context.now();
  const recorder = createTraceRecorder(options);
  const emit = (event: Parameters<typeof context.emit>[0]) => {
    recorder.record(event);
    context.emit(event);
  };
  const limits = checkLimits(scenario, options);
  if (!limits.ok) return { ...limits.result!, objective: "makespan" };
  if (scenario.kind !== "tapf" || !scenario.teams || scenario.teams.length !== 1)
    return error("unsupported-rules", "MCMF は 1 チーム TAPF にのみ対応します。");
  const problems = validateScenario(scenario);
  if (problems.length > 0) return error("invalid-scenario", problems.join(" / "));
  const team = scenario.teams[0]!;
  const starts = team.agentIds.map((id) => scenario.agents.find((agent) => agent.id === id)?.start);
  if (starts.some((cell): cell is undefined => cell === undefined))
    return error("invalid-scenario", "チームの開始位置が取得できません。");
  let lower = 0;
  for (const start of starts as readonly Cell[])
    lower = Math.max(lower, Math.min(...team.goals.map((goal) => manhattan(start, goal))));
  const maxHorizon = Math.min(
    options.maxHorizon,
    options.horizon ?? Math.max(64, lower + scenario.map.width * scenario.map.height),
  );
  const constraints: TeamFlowConstraint[] = [];
  for (let horizon = lower; horizon <= maxHorizon; horizon += 1) {
    const stop = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
    if (stop !== "ok") return failure(stop, "limit-exceeded", startedAt, context);
    const flow = solveTeamByMinCostFlow(
      scenario.map,
      team,
      starts as readonly Cell[],
      horizon,
      constraints,
    );
    if (!flow) continue;
    const conflicts = detectConflicts(flow.paths, scenario.rules);
    emit({
      type: "expand-node",
      state: { phase: "time-expanded-flow", horizon, flow: flow.cost, conflicts: conflicts.length },
    });
    if (conflicts.length === 0) {
      const result = buildResult(
        scenario,
        flow.paths,
        context.now() - startedAt,
        horizon,
        "solved",
      );
      const final: SolverResult = {
        ...result,
        objective: "makespan",
        targetAssignments: targetAssignments(team, flow.paths),
        warnings: [
          {
            code: "simplified-behavior",
            message:
              "MCMF は makespan の最小化を優先します。複数チームの衝突解消は CBM を使用してください。",
          },
        ],
        trace: recorder.events,
      };
      emit({ type: "finish", result: final });
      return final;
    }
    addInternalConstraints(conflicts, constraints);
    for (const conflict of conflicts) emit({ type: "detect-conflict", conflict });
  }
  return failure("no-solution", "search-exhausted", startedAt, context);
}

function addInternalConstraints(
  conflicts: readonly Conflict[],
  constraints: TeamFlowConstraint[],
): void {
  for (const conflict of conflicts) {
    if (conflict.kind === "vertex" || conflict.kind === "following") {
      constraints.push({
        kind: "vertex",
        cell: conflict.kind === "vertex" ? conflict.cell : conflict.cell,
        time: conflict.time,
      });
    } else {
      constraints.push({ kind: "edge", from: conflict.from, to: conflict.to, time: conflict.time });
      constraints.push({ kind: "edge", from: conflict.to, to: conflict.from, time: conflict.time });
    }
  }
}

function targetAssignments(
  team: TeamSpec,
  paths: readonly TimedPath[],
): SolverResult["targetAssignments"] {
  return team.agentIds.flatMap((agentId) => {
    const path = paths.find((candidate) => candidate.agentId === agentId);
    const goal = path?.positions[path.positions.length - 1]?.cell;
    return goal ? [{ agentId, teamId: team.id, goal }] : [];
  });
}

function error(code: "unsupported-rules" | "invalid-scenario", message: string): SolverResult {
  return {
    outcome: "error",
    paths: [],
    metrics: { sumOfCosts: 0, makespan: 0, runtimeMs: 0 },
    conflicts: [],
    error: { code, message },
    failureReason: code === "unsupported-rules" ? "unsupported-rules" : "internal",
    objective: "makespan",
  };
}

function failure(
  outcome: SolverResult["outcome"],
  reason: SolverResult["failureReason"],
  startedAt: number,
  context: SolverContext,
): SolverResult {
  return {
    outcome,
    paths: [],
    metrics: { sumOfCosts: 0, makespan: 0, runtimeMs: context.now() - startedAt },
    conflicts: [],
    failureReason: reason,
    objective: "makespan",
  };
}
