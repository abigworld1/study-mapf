import type {
  Cell,
  FailureReason,
  MapfSolver,
  Scenario,
  SolverContext,
  SolverEvent,
  SolverOptions,
  SolverOutcome,
  SolverResult,
  SolverWarning,
  TimedPath,
  TimedPosition,
} from "@/lib/model/types.js";
import { isWalkable, lookupDistance, trueDistanceFrom } from "@/lib/model/grid.js";
import { positionAt } from "@/lib/model/conflicts.js";
import { SimpleReservationTable, reservePathForRules } from "@/lib/model/reservation.js";
import { createTraceRecorder } from "../context.js";
import { checkLimits } from "../limits.js";
import { ReverseResumableAStar } from "../low-level/reverse-resumable-astar.js";
import type { LowLevelStopReason } from "../low-level/space-time-astar.js";
import { windowedSpaceTimeAStar } from "../low-level/windowed-space-time-astar.js";
import { buildResult, checkAbort, defaultMaxTime } from "../shared.js";

interface WindowOptions {
  readonly windowSize: number;
  readonly replanInterval: number;
}

export const whcaStarSolver: MapfSolver = {
  metadata: {
    id: "whca-star",
    displayName: "WHCA*",
    originalName: "Windowed Hierarchical Cooperative A*",
    category: "prioritized-planning",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: ["allowDiagonal"],
    basedOnPaperIds: ["cooperative-pathfinding-2005"],
    implementationNote:
      "Silver (2005) の window terminal edge、RRA* 再利用、midpoint 再計画、動的 priority を実装。ブラウザ版は同期 window と単純 rotation を使い、サイト既定の stay-at-goal を守るため goal 到達後は離れない。",
  },

  async solve(scenario, options, context): Promise<SolverResult> {
    return solveWhcaStar(scenario, options, context);
  },
};

async function solveWhcaStar(
  scenario: Scenario,
  options: SolverOptions,
  context: SolverContext,
): Promise<SolverResult> {
  const startedAt = context.now();
  const recorder = createTraceRecorder(options);
  const limits = checkLimits(scenario, options);
  const warnings: SolverWarning[] = [
    ...limits.warnings,
    {
      code: "simplified-behavior",
      message:
        "Silver (2005) の WHCA* は goal 到達後も window を続けて一時的に goal を離れられます。ブラウザ版は scenario.rules.goalBehavior を優先し、stay では到達後に離れません。",
    },
    ...(options.suboptimalityFactor !== undefined
      ? [
          {
            code: "option-ignored" as const,
            message: "WHCA* は suboptimalityFactor を使用しません。",
          },
        ]
      : []),
  ];
  const emit = (event: SolverEvent) => {
    recorder.record(event);
    context.emit(event);
  };
  let expanded = 0;
  let cooperativeGenerated = 0;
  let replans = 0;
  const rraByAgent = new Map<string, ReverseResumableAStar>();

  if (!limits.ok) return finish(limits.result!);
  if (scenario.kind !== "one-shot-mapf") {
    return finish(errorResult("WHCA* は one-shot MAPF のみに対応しています", "unsupported-rules"));
  }
  if (scenario.rules.allowDiagonal) {
    return finish(errorResult("この実装は 4 近傍 grid のみに対応しています", "unsupported-rules"));
  }
  if (scenario.agents.length === 0) {
    return finish(errorResult("エージェントが 1 体もありません", "invalid-scenario"));
  }

  const parsed = parseWindowOptions(options);
  if ("error" in parsed) return finish(errorResult(parsed.error, "invalid-scenario"));
  const { windowSize, replanInterval } = parsed.value;
  const requestedHorizon = options.horizon ?? defaultMaxTime(scenario);
  const maxTime = Math.min(requestedHorizon, options.maxHorizon);
  if (requestedHorizon > options.maxHorizon) {
    warnings.push({
      code: "input-too-large",
      message: `探索 horizon を maxHorizon=${options.maxHorizon} に制限しました。`,
    });
  }

  let lowerBound = 0;
  for (const agent of scenario.agents) {
    if (!agent.goal) {
      return finish(errorResult(`${agent.id} に goal が設定されていません`, "invalid-scenario"));
    }
    if (!isWalkable(scenario.map, agent.start) || !isWalkable(scenario.map, agent.goal)) {
      return finish(
        errorResult(`${agent.id} の start または goal が通行不能です`, "invalid-scenario"),
      );
    }
    const distance = lookupDistance(
      scenario.map,
      trueDistanceFrom(scenario.map, agent.goal),
      agent.start,
    );
    if (!Number.isFinite(distance)) {
      return finish(failureResult("no-solution", "unreachable-goal"));
    }
    lowerBound += distance;
  }

  const consumeExpansion = (): "ok" | LowLevelStopReason => {
    const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
    if (abort !== "ok") return abort;
    if (expanded >= options.maxExpansions) return "max-expansions";
    expanded += 1;
    return "ok";
  };

  for (const agent of scenario.agents) {
    rraByAgent.set(
      agent.id,
      new ReverseResumableAStar({
        map: scenario.map,
        origin: agent.start,
        goal: agent.goal!,
        maxExpansions: options.maxExpansions,
        consumeExpansion,
        onExpand: (cell, distanceFromGoal) => {
          emit({
            type: "expand-node",
            agentId: agent.id,
            state: { phase: "abstract-rra", cell, distanceFromGoal },
          });
        },
      }),
    );
  }

  const paths = new Map<string, TimedPath>(
    scenario.agents.map((agent) => [
      agent.id,
      { agentId: agent.id, positions: [{ time: 0, cell: agent.start }] },
    ]),
  );
  const done = new Set(
    scenario.agents
      .filter((agent) => agent.goal!.x === agent.start.x && agent.goal!.y === agent.start.y)
      .map((agent) => agent.id),
  );
  let priorityIds = scenario.agents.map((agent) => agent.id);
  let currentTime = 0;

  while (done.size < scenario.agents.length && currentTime < maxTime) {
    const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
    if (abort !== "ok") return finish(failureResult(abort, "limit-exceeded"));

    const windowEnd = Math.min(maxTime, currentTime + windowSize);
    const activeIds = priorityIds.filter((id) => !done.has(id));
    emit({
      type: "replan",
      agentIds: activeIds,
      reason: `WHCA* window ${currentTime}-${windowEnd}`,
    });

    let chosen:
      | {
          readonly order: readonly string[];
          readonly partial: ReadonlyMap<string, TimedPath>;
          readonly reachedGoal: ReadonlySet<string>;
        }
      | undefined;
    let lastStop: "no-path" | LowLevelStopReason | undefined;

    for (let attempt = 0; attempt < Math.max(1, activeIds.length); attempt += 1) {
      const order = rotate(activeIds, attempt);
      const table = new SimpleReservationTable();
      for (const id of done) {
        reservePathForRules(table, paths.get(id)!, maxTime, scenario.rules);
      }
      const partial = new Map<string, TimedPath>();
      const reachedGoal = new Set<string>();
      let failed = false;

      for (let index = 0; index < order.length; index += 1) {
        const id = order[index]!;
        const agent = scenario.agents.find((candidate) => candidate.id === id)!;
        const currentPath = paths.get(id)!;
        const start = positionAt(currentPath, currentTime, scenario.rules);
        if (!start) {
          reachedGoal.add(id);
          continue;
        }
        for (let higher = 0; higher < index; higher += 1) {
          emit({ type: "set-priority", higher: order[higher]!, lower: id });
        }

        replans += 1;
        const rra = rraByAgent.get(id)!;
        const output = windowedSpaceTimeAStar({
          map: scenario.map,
          start,
          goal: agent.goal!,
          agentId: id,
          rules: scenario.rules,
          reservations: table,
          startTime: currentTime,
          windowEnd,
          maxExpansions: options.maxExpansions,
          consumeExpansion,
          heuristic: (cell) => rra.distance(cell),
          onExpand: (cell, time, f) => {
            emit({
              type: "expand-node",
              agentId: id,
              state: { phase: "window", cell, time, f, windowEnd },
            });
          },
          onReject: (cell, time, reason) => {
            emit({ type: "reject-reserved-state", agentId: id, cell, time, reason });
          },
        });
        cooperativeGenerated += output.generated;
        lastStop = rra.reason ?? output.reason;
        if (!output.path) {
          failed = true;
          emit({ type: "backtrack", agentId: id });
          break;
        }
        partial.set(id, output.path);
        if (output.reachedGoal) reachedGoal.add(id);
        reservePathForRules(table, output.path, windowEnd, scenario.rules);
        for (const position of output.path.positions) {
          emit({ type: "reserve", agentId: id, cell: position.cell, time: position.time });
        }
      }

      if (!failed) {
        chosen = { order, partial, reachedGoal };
        break;
      }
      if (lastStop === "timeout" || lastStop === "aborted" || lastStop === "max-expansions") break;
    }

    if (!chosen) {
      if (lastStop === "timeout" || lastStop === "aborted") {
        return finish(failureResult(lastStop, "limit-exceeded"));
      }
      if (lastStop === "max-expansions") {
        return finish(failureResult("node-limit", "limit-exceeded"));
      }
      return finish(failureResult("no-solution", "priority-order"));
    }

    const executeEnd = Math.min(windowEnd, currentTime + replanInterval);
    for (const id of activeIds) {
      const partial = chosen.partial.get(id);
      if (!partial) continue;
      const oldPath = paths.get(id)!;
      const positions: TimedPosition[] = [...oldPath.positions];
      for (let time = currentTime + 1; time <= executeEnd; time += 1) {
        const cell = positionAt(partial, time, scenario.rules);
        if (!cell) break;
        positions.push({ time, cell });
      }
      paths.set(id, { agentId: id, positions });

      const arrival = partial.positions[partial.positions.length - 1]?.time;
      if (chosen.reachedGoal.has(id) && arrival !== undefined && arrival <= executeEnd)
        done.add(id);
    }

    for (let time = currentTime + 1; time <= executeEnd; time += 1) {
      const positions: Record<string, Cell> = {};
      for (const agent of scenario.agents) {
        const cell = positionAt(paths.get(agent.id)!, time, scenario.rules);
        if (cell) positions[agent.id] = cell;
      }
      emit({ type: "move", time, positions });
    }

    currentTime = executeEnd;
    const nextActive = rotate(chosen.order, chosen.order.length > 1 ? 1 : 0).filter(
      (id) => !done.has(id),
    );
    priorityIds = [
      ...nextActive,
      ...scenario.agents.map((agent) => agent.id).filter((id) => done.has(id)),
    ];
    emit({
      type: "progress",
      ratio: done.size / scenario.agents.length,
      label: `${done.size}/${scenario.agents.length} agents が goal に到達`,
    });
  }

  if (done.size < scenario.agents.length) {
    warnings.push({
      code: "simplified-behavior",
      message: `探索 horizon ${maxTime} までに全 agent が goal へ到達しませんでした。`,
    });
    return finish(failureResult("no-solution", "limit-exceeded"));
  }

  const orderedPaths = scenario.agents.map((agent) => paths.get(agent.id)!);
  const generated =
    cooperativeGenerated +
    [...rraByAgent.values()].reduce((total, search) => total + search.generated, 0);
  const result = buildResult(
    scenario,
    orderedPaths,
    context.now() - startedAt,
    expanded,
    "solved",
    { generatedNodes: generated, replans, lowerBound },
  );
  if (result.conflicts.length > 0) {
    for (const conflict of result.conflicts) emit({ type: "detect-conflict", conflict });
    return finish({
      ...result,
      outcome: "error",
      failureReason: "internal",
      error: { code: "internal", message: "window 実行後の解に衝突が残りました。" },
    });
  }
  return finish(result);

  function generatedSoFar(): number {
    return (
      cooperativeGenerated +
      [...rraByAgent.values()].reduce((total, search) => total + search.generated, 0)
    );
  }

  function errorResult(
    message: string,
    code: "invalid-scenario" | "unsupported-rules",
  ): SolverResult {
    return {
      outcome: "error",
      paths: [],
      metrics: { sumOfCosts: 0, makespan: 0, runtimeMs: context.now() - startedAt },
      conflicts: [],
      error: { code, message },
      failureReason: code === "unsupported-rules" ? "unsupported-rules" : "internal",
    };
  }

  function failureResult(
    outcome: Exclude<SolverOutcome, "solved" | "error">,
    failureReason: FailureReason,
  ): SolverResult {
    return {
      outcome,
      paths: [],
      metrics: {
        sumOfCosts: 0,
        makespan: 0,
        runtimeMs: context.now() - startedAt,
        expandedNodes: expanded,
        generatedNodes: generatedSoFar(),
        replans,
      },
      conflicts: [],
      failureReason,
    };
  }

  function finish(base: SolverResult): SolverResult {
    const eventWarnings = mergeWarnings(base.warnings, warnings);
    const eventResult: SolverResult = {
      ...base,
      ...(eventWarnings.length > 0 ? { warnings: eventWarnings } : {}),
    };
    emit({ type: "finish", result: eventResult });
    const finalWarnings = mergeWarnings(eventWarnings, recorder.warnings);
    return {
      ...eventResult,
      ...(finalWarnings.length > 0 ? { warnings: finalWarnings } : {}),
      ...(options.traceLevel === "off" ? {} : { trace: recorder.events }),
    };
  }
}

function parseWindowOptions(
  options: SolverOptions,
): { readonly value: WindowOptions } | { readonly error: string } {
  const rawWindow = options.extra?.windowSize ?? 16;
  const rawInterval =
    options.extra?.replanInterval ??
    (typeof rawWindow === "number" ? Math.max(1, Math.floor(rawWindow / 2)) : 1);
  if (!Number.isInteger(rawWindow) || (rawWindow as number) < 2) {
    return { error: "extra.windowSize は 2 以上の整数で指定してください" };
  }
  if ((rawWindow as number) > options.maxHorizon) {
    return { error: "extra.windowSize は maxHorizon 以下にしてください" };
  }
  if (
    !Number.isInteger(rawInterval) ||
    (rawInterval as number) < 1 ||
    (rawInterval as number) > (rawWindow as number)
  ) {
    return { error: "extra.replanInterval は 1 以上 windowSize 以下の整数で指定してください" };
  }
  return {
    value: { windowSize: rawWindow as number, replanInterval: rawInterval as number },
  };
}

function rotate<T>(items: readonly T[], amount: number): T[] {
  if (items.length === 0) return [];
  const normalized = amount % items.length;
  return [...items.slice(normalized), ...items.slice(0, normalized)];
}

function mergeWarnings(
  ...groups: readonly (readonly SolverWarning[] | undefined)[]
): SolverWarning[] {
  const out: SolverWarning[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const warning of group ?? []) {
      const key = `${warning.code}\u0000${warning.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(warning);
    }
  }
  return out;
}
