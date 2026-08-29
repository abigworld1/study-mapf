import type {
  AgentSpec,
  FailureReason,
  MapfSolver,
  Scenario,
  SolverContext,
  SolverEvent,
  SolverMetadata,
  SolverOptions,
  SolverOutcome,
  SolverResult,
  SolverWarning,
  TimedPath,
} from "@/lib/model/types.js";
import { isWalkable, lookupDistance, manhattan, trueDistanceFrom } from "@/lib/model/grid.js";
import { SimpleReservationTable, reservePathForRules } from "@/lib/model/reservation.js";
import { createTraceRecorder } from "../context.js";
import { checkLimits } from "../limits.js";
import { buildResult, checkAbort, defaultMaxTime } from "../shared.js";
import { ReverseResumableAStar } from "../low-level/reverse-resumable-astar.js";
import {
  spaceTimeAStar,
  type LowLevelStopReason,
  type SpaceTimeAStarOutput,
} from "../low-level/space-time-astar.js";
import { sippSearch, type SippOutput } from "../low-level/sipp.js";

export interface SequentialSolverConfig {
  readonly planner: "space-time" | "sipp";
  readonly heuristic: "manhattan" | "true-distance" | "rra";
  readonly allowPriorityOrderOption?: boolean;
  readonly requireSingleAgent?: boolean;
  readonly warnings?: readonly SolverWarning[];
}

/**
 * 固定優先順位 + 予約表という共通骨格を作る。
 * CA* / HCA* / Prioritized Planning は heuristic と option の違いを明示して使い分ける。
 * SIPP Solver は原論文外の MAPF wrapper として同じ coordinator を利用する。
 */
export function createSequentialSolver(
  metadata: SolverMetadata,
  config: SequentialSolverConfig,
): MapfSolver {
  return {
    metadata,
    /*
      ★ 受け付けない形は canSolve で断る。solve の中でエラーにするだけでは
        UI の候補一覧に出てしまう。

        Space-Time A* は単一エージェント専用なのに canSolve が無く、
        one-shot のプリセットは 8 件すべて 2 体以上だったので、
        選ぶと必ずエラーになる状態だった。single-agent プリセットを
        足すのと対で直している。
    */
    ...(config.requireSingleAgent
      ? { canSolve: (scenario: Scenario) => scenario.agents.length === 1 }
      : {}),
    async solve(scenario, options, context): Promise<SolverResult> {
      return solveSequential(scenario, options, context, config);
    },
  };
}

async function solveSequential(
  scenario: Scenario,
  options: SolverOptions,
  context: SolverContext,
  config: SequentialSolverConfig,
): Promise<SolverResult> {
  const startedAt = context.now();
  const recorder = createTraceRecorder(options);
  const limitCheck = checkLimits(scenario, options);
  const baseWarnings: SolverWarning[] = [
    ...limitCheck.warnings,
    ...(config.warnings ?? []),
    ...(options.suboptimalityFactor !== undefined
      ? [
          {
            code: "option-ignored" as const,
            message: "この Solver は suboptimalityFactor を使用しません。",
          },
        ]
      : []),
  ];
  const emit = (event: SolverEvent) => {
    recorder.record(event);
    context.emit(event);
  };
  let expanded = 0;
  let generated = 0;

  if (!limitCheck.ok) return finish(limitCheck.result!);

  if (scenario.kind !== "one-shot-mapf") {
    return finish(
      errorResult("この Solver は one-shot MAPF のみに対応しています", "unsupported-rules"),
    );
  }
  if (scenario.rules.allowDiagonal) {
    return finish(errorResult("この実装は 4 近傍 grid のみに対応しています", "unsupported-rules"));
  }
  if (scenario.agents.length === 0) {
    return finish(errorResult("エージェントが 1 体もありません", "invalid-scenario"));
  }
  if (config.requireSingleAgent && scenario.agents.length !== 1) {
    return finish(
      errorResult(
        "Space-Time A* は低レベルの単一エージェント探索です。複数エージェントには Cooperative A* または HCA* を選んでください。",
        "invalid-scenario",
      ),
    );
  }

  const orderResult = resolveOrder(scenario.agents, options, config.allowPriorityOrderOption);
  if ("error" in orderResult) return finish(errorResult(orderResult.error, "invalid-scenario"));
  const order = orderResult.order;

  const requestedHorizon = options.horizon ?? defaultMaxTime(scenario);
  const maxTime = Math.min(requestedHorizon, options.maxHorizon);
  if (requestedHorizon > options.maxHorizon) {
    baseWarnings.push({
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
      return finish(failureResult("no-solution", "unreachable-goal", 0));
    }
    lowerBound += distance;
  }

  const table = new SimpleReservationTable();
  const paths: TimedPath[] = [];
  const consumeExpansion = (): "ok" | LowLevelStopReason => {
    const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
    if (abort !== "ok") return abort;
    if (expanded >= options.maxExpansions) return "max-expansions";
    expanded += 1;
    return "ok";
  };

  for (let index = 0; index < order.length; index += 1) {
    const agent = order[index]!;
    const goal = agent.goal!;
    const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
    if (abort !== "ok") return finish(failureResult(abort, "limit-exceeded", generated));

    for (let higher = 0; higher < index; higher += 1) {
      emit({ type: "set-priority", higher: order[higher]!.id, lower: agent.id });
    }

    let output: SpaceTimeAStarOutput | SippOutput;
    let rra: ReverseResumableAStar | undefined;
    if (config.planner === "sipp") {
      output = sippSearch({
        map: scenario.map,
        start: agent.start,
        goal,
        agentId: agent.id,
        rules: scenario.rules,
        reservations: table,
        maxTime,
        maxExpansions: options.maxExpansions,
        consumeExpansion,
        heuristic: trueDistanceFrom(scenario.map, goal),
        onExpand: (cell, interval, time, f) => {
          emit({
            type: "expand-node",
            agentId: agent.id,
            state: { phase: "safe-interval", cell, interval, time, f },
          });
        },
        onDiscoverInterval: (cell, interval) => {
          emit({
            type: "discover-safe-interval",
            agentId: agent.id,
            cell,
            from: interval.start,
            to: interval.end,
          });
        },
        onReject: (cell, time, reason) => {
          emit({ type: "reject-reserved-state", agentId: agent.id, cell, time, reason });
        },
      });
    } else {
      const heuristic = (() => {
        if (config.heuristic === "manhattan")
          return (cell: { x: number; y: number }) => manhattan(cell, goal);
        if (config.heuristic === "true-distance") return trueDistanceFrom(scenario.map, goal);
        rra = new ReverseResumableAStar({
          map: scenario.map,
          origin: agent.start,
          goal,
          maxExpansions: options.maxExpansions,
          consumeExpansion,
          onExpand: (cell, distanceFromGoal) => {
            emit({
              type: "expand-node",
              agentId: agent.id,
              state: { phase: "abstract-rra", cell, distanceFromGoal },
            });
          },
        });
        return (cell: { x: number; y: number }) => rra!.distance(cell);
      })();

      output = spaceTimeAStar({
        map: scenario.map,
        start: agent.start,
        goal,
        agentId: agent.id,
        rules: scenario.rules,
        reservations: table,
        reservationHorizon: maxTime,
        maxTime,
        maxExpansions: options.maxExpansions,
        consumeExpansion,
        heuristic,
        onExpand: (cell, time, f) => {
          emit({
            type: "expand-node",
            agentId: agent.id,
            state: { phase: "cooperative", cell, time, f },
          });
        },
        onReject: (cell, time, reason) => {
          emit({ type: "reject-reserved-state", agentId: agent.id, cell, time, reason });
        },
      });
    }

    generated += output.generated + (rra?.generated ?? 0);
    const reason = rra?.reason ?? output.reason;
    if (!output.path) {
      if (reason === "timeout" || reason === "aborted") {
        return finish(failureResult(reason, "limit-exceeded", generated));
      }
      if (reason === "max-expansions") {
        return finish(failureResult("node-limit", "limit-exceeded", generated));
      }
      if (reason === "max-time") {
        baseWarnings.push({
          code: "simplified-behavior",
          message: `時刻上限 ${maxTime} までに ${agent.id} の経路を見つけられませんでした。`,
        });
      }
      return finish(
        failureResult(
          "no-solution",
          index === 0 ? "unreachable-goal" : "priority-order",
          generated,
        ),
      );
    }

    paths.push(output.path);
    reservePathForRules(table, output.path, maxTime, scenario.rules);
    for (const position of output.path.positions) {
      emit({ type: "reserve", agentId: agent.id, cell: position.cell, time: position.time });
    }
    emit({
      type: "progress",
      ratio: (index + 1) / order.length,
      label: `${agent.id} を計画（優先度 ${index + 1}）`,
    });
  }

  const result = buildResult(scenario, paths, context.now() - startedAt, expanded, "solved", {
    generatedNodes: generated,
    lowerBound,
  });
  if (result.conflicts.length > 0) {
    for (const conflict of result.conflicts) emit({ type: "detect-conflict", conflict });
    return finish({
      ...result,
      outcome: "error",
      failureReason: "internal",
      error: {
        code: "internal",
        message: "予約表で防ぐべき衝突が解に残りました。",
      },
    });
  }
  return finish(result);

  function errorResult(
    message: string,
    code: "invalid-scenario" | "unsupported-rules",
  ): SolverResult {
    return {
      outcome: "error",
      paths: [],
      metrics: {
        sumOfCosts: 0,
        makespan: 0,
        runtimeMs: context.now() - startedAt,
      },
      conflicts: [],
      error: { code, message },
      failureReason: code === "unsupported-rules" ? "unsupported-rules" : "internal",
    };
  }

  function failureResult(
    outcome: Exclude<SolverOutcome, "solved" | "error">,
    failureReason: FailureReason,
    generatedNodes: number,
  ): SolverResult {
    return {
      outcome,
      paths: [],
      metrics: {
        sumOfCosts: 0,
        makespan: 0,
        runtimeMs: context.now() - startedAt,
        expandedNodes: expanded,
        generatedNodes,
      },
      conflicts: [],
      failureReason,
    };
  }

  function finish(base: SolverResult): SolverResult {
    const beforeTraceWarnings = mergeWarnings(base.warnings, baseWarnings);
    const eventResult: SolverResult = {
      ...base,
      ...(beforeTraceWarnings.length > 0 ? { warnings: beforeTraceWarnings } : {}),
    };
    emit({ type: "finish", result: eventResult });
    const warnings = mergeWarnings(beforeTraceWarnings, recorder.warnings);
    return {
      ...eventResult,
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(options.traceLevel === "off" ? {} : { trace: recorder.events }),
    };
  }
}

function resolveOrder(
  agents: readonly AgentSpec[],
  options: SolverOptions,
  allowOption = false,
): { readonly order: readonly AgentSpec[] } | { readonly error: string } {
  const raw = options.extra?.priorityOrder;
  if (!allowOption || raw === undefined) return { order: agents };
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string")) {
    return { error: "extra.priorityOrder は agent ID の配列で指定してください" };
  }
  const ids = raw as string[];
  if (ids.length !== agents.length || new Set(ids).size !== ids.length) {
    return { error: "extra.priorityOrder は全 agent を重複なく 1 回ずつ含めてください" };
  }
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const order: AgentSpec[] = [];
  for (const id of ids) {
    const agent = byId.get(id);
    if (!agent) return { error: `extra.priorityOrder に未知の agent ID ${id} があります` };
    order.push(agent);
  }
  return { order };
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
