import type {
  AgentSpec,
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
} from "@/lib/model/types.js";
import {
  cellEquals,
  cellIndex,
  cellKey,
  isWalkable,
  lookupDistance,
  movesWithWait,
  trueDistanceFrom,
} from "@/lib/model/grid.js";
import { createTraceRecorder } from "../context.js";
import { checkLimits } from "../limits.js";
import { buildResult, checkAbort } from "../shared.js";

type StopState = "timeout" | "aborted" | "node-limit" | null;

export const pibtSolver: MapfSolver = {
  metadata: {
    id: "pibt",
    displayName: "PIBT（優先度継承＋バックトラック）",
    originalName: "Priority Inheritance with Backtracking",
    category: "pibt-lacam",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "reference-validated",
    unsupportedRules: ["allowDiagonal", "forbidFollowing", "goalBehavior"],
    basedOnPaperIds: ["pibt-aij-2022"],
    validatedAgainst: [
      "Kei18/pypibt a3c97f60: fully occupied 2x2 clockwise rotation (seed=4) で success、makespan=1、同一 configuration 列、path validity を比較。",
    ],
    implementationNote:
      "AIJ 2022 Algorithm 1 の 1-step priority inheritance / backtracking と §4.4.1 の one-shot termination を実装。iterative goal 更新と PIBT+ は未対応。",
  },

  async solve(scenario, options, context): Promise<SolverResult> {
    return solvePibt(scenario, options, context);
  },
};

async function solvePibt(
  scenario: Scenario,
  options: SolverOptions,
  context: SolverContext,
): Promise<SolverResult> {
  const startedAt = context.now();
  const recorder = createTraceRecorder(options);
  const limitCheck = checkLimits(scenario, options);
  const warnings: SolverWarning[] = [
    ...limitCheck.warnings,
    ...(options.suboptimalityFactor !== undefined
      ? [
          {
            code: "option-ignored" as const,
            message: "PIBT は suboptimalityFactor を使用しません。",
          },
        ]
      : []),
  ];
  const emit = (event: SolverEvent): void => {
    recorder.record(event);
    context.emit(event);
  };
  let expanded = 0;
  let generated = 0;
  let stopState: StopState = null;

  if (!limitCheck.ok) return finish(limitCheck.result!);
  const validation = validatePibtScenario(scenario);
  if (validation) return finish(errorResult(validation.message, validation.code));

  const agents = scenario.agents as readonly (AgentSpec & { readonly goal: Cell })[];
  const maxTimestepsResult = resolveMaxTimesteps(scenario, options);
  if ("error" in maxTimestepsResult) {
    return finish(errorResult(maxTimestepsResult.error, "invalid-scenario"));
  }
  const maxTimesteps = maxTimestepsResult.value;
  const distances = agents.map((agent) => trueDistanceFrom(scenario.map, agent.goal));
  for (let index = 0; index < agents.length; index += 1) {
    if (!Number.isFinite(lookupDistance(scenario.map, distances[index]!, agents[index]!.start))) {
      return finish(failureResult("no-solution", "unreachable-goal"));
    }
  }

  // epsilon は unique であればよい。seed 付き permutation を fractional part に写す。
  const epsilonOrder = shuffledIndices(agents.length, context.random);
  const epsilons = new Array<number>(agents.length);
  for (let rank = 0; rank < epsilonOrder.length; rank += 1) {
    epsilons[epsilonOrder[rank]!] = (rank + 1) / (agents.length + 1);
  }
  const tieRanks = agents.map(() =>
    Array.from({ length: scenario.map.width * scenario.map.height }, () => context.random()),
  );
  const eta = new Array<number>(agents.length).fill(0);
  let current = agents.map((agent) => agent.start);
  const histories = current.map((cell) => [cell]);

  if (atGoalConfiguration(current, agents)) {
    return solvedResult();
  }

  for (let time = 0; time < maxTimesteps; time += 1) {
    const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
    if (abort !== "ok") return finish(failureResult(abort, "limit-exceeded"));

    const priorities = agents.map((_, index) => eta[index]! + epsilons[index]!);
    const order = agents
      .map((_, index) => index)
      .sort((a, b) => priorities[b]! - priorities[a]! || a - b);
    emit({
      type: "priority-order",
      time,
      order: order.map((index) => agents[index]!.id),
    });

    const ownerNow = new Map<string, number>();
    for (let index = 0; index < current.length; index += 1) {
      ownerNow.set(cellKey(current[index]!), index);
    }
    const ownerNext = new Map<string, number>();
    const next: (Cell | undefined)[] = new Array(agents.length);

    for (const agentIndex of order) {
      if (next[agentIndex] !== undefined) continue;
      assign(agentIndex, undefined);
      const stopped = stopResultIfNeeded();
      if (stopped) return finish(stopped);
    }

    if (next.some((cell) => cell === undefined)) {
      return finish(internalError("PIBT が次 configuration の全 agent を割り当てませんでした。"));
    }
    const nextConfiguration = next as Cell[];
    if (!isConflictFreeTransition(current, nextConfiguration, scenario.rules.forbidEdgeSwap)) {
      return finish(internalError("PIBT の priority inheritance 後に conflict が残りました。"));
    }

    current = nextConfiguration.map((cell) => ({ ...cell }));
    const positions: Record<string, Cell> = {};
    for (let index = 0; index < agents.length; index += 1) {
      histories[index]!.push(current[index]!);
      positions[agents[index]!.id] = current[index]!;
      eta[index] = cellEquals(current[index]!, agents[index]!.goal) ? 0 : eta[index]! + 1;
    }
    emit({ type: "move", time: time + 1, positions });
    emit({
      type: "progress",
      ratio: Math.min(1, (time + 1) / maxTimesteps),
      label: `PIBT timestep ${time + 1}`,
    });

    if (atGoalConfiguration(current, agents)) return solvedResult();

    function assign(agentIndex: number, requester: number | undefined): boolean {
      const stop = consumeExpansion();
      if (stop !== "ok") return false;

      const candidates = movesWithWait(scenario.map, current[agentIndex]!, scenario.rules)
        .filter((cell) =>
          Number.isFinite(lookupDistance(scenario.map, distances[agentIndex]!, cell)),
        )
        .sort((left, right) => {
          const leftDistance = lookupDistance(scenario.map, distances[agentIndex]!, left);
          const rightDistance = lookupDistance(scenario.map, distances[agentIndex]!, right);
          const leftOccupied = ownerNow.has(cellKey(left)) ? 1 : 0;
          const rightOccupied = ownerNow.has(cellKey(right)) ? 1 : 0;
          return (
            leftDistance - rightDistance ||
            leftOccupied - rightOccupied ||
            tieRanks[agentIndex]![cellIndex(scenario.map, left)]! -
              tieRanks[agentIndex]![cellIndex(scenario.map, right)]! ||
            cellIndex(scenario.map, left) - cellIndex(scenario.map, right)
          );
        });
      emit({
        type: "candidate-evaluation",
        agentId: agents[agentIndex]!.id,
        candidates: candidates.map((cell) => ({
          cell,
          score: lookupDistance(scenario.map, distances[agentIndex]!, cell),
        })),
      });

      for (const candidate of candidates) {
        generated += 1;
        const key = cellKey(candidate);
        if (ownerNext.has(key)) continue;
        if (
          scenario.rules.forbidEdgeSwap &&
          requester !== undefined &&
          cellEquals(candidate, current[requester]!)
        ) {
          continue;
        }

        next[agentIndex] = candidate;
        ownerNext.set(key, agentIndex);
        const occupant = ownerNow.get(key);
        if (occupant !== undefined && next[occupant] === undefined) {
          emit({
            type: "inherit-priority",
            from: agents[agentIndex]!.id,
            to: agents[occupant]!.id,
          });
          if (!assign(occupant, agentIndex)) {
            emit({ type: "backtrack", agentId: agents[agentIndex]!.id });
            continue;
          }
        }
        return true;
      }

      const wait = current[agentIndex]!;
      next[agentIndex] = wait;
      ownerNext.set(cellKey(wait), agentIndex);
      emit({ type: "backtrack", agentId: agents[agentIndex]!.id });
      return false;
    }
  }

  warnings.push({
    code: "simplified-behavior",
    message: `PIBT は ${maxTimesteps} timestep 以内に simultaneous goal configuration へ到達しませんでした。これは解不存在の証明ではありません。`,
  });
  return finish(failureResult("no-solution", "search-exhausted"));

  function consumeExpansion(): "ok" | "timeout" | "aborted" | "node-limit" {
    const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
    if (abort !== "ok") {
      stopState = abort;
      return abort;
    }
    if (expanded >= options.maxExpansions) {
      stopState = "node-limit";
      return "node-limit";
    }
    expanded += 1;
    return "ok";
  }

  function solvedResult(): SolverResult {
    const paths: TimedPath[] = agents.map((agent, index) => ({
      agentId: agent.id,
      positions: histories[index]!.map((cell, time) => ({ time, cell })),
    }));
    const result = buildResult(scenario, paths, context.now() - startedAt, expanded, "solved", {
      generatedNodes: generated,
    });
    return finish(result);
  }

  function stopResultIfNeeded(): SolverResult | null {
    if (stopState === "timeout" || stopState === "aborted") {
      return failureResult(stopState, "limit-exceeded");
    }
    if (stopState === "node-limit") return failureResult("node-limit", "limit-exceeded");
    return null;
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

  function internalError(message: string): SolverResult {
    return {
      ...failureResult("error", "internal"),
      error: { code: "internal", message },
    };
  }

  function failureResult(outcome: SolverOutcome, failureReason: FailureReason): SolverResult {
    return {
      outcome,
      paths: [],
      metrics: {
        sumOfCosts: 0,
        makespan: 0,
        runtimeMs: context.now() - startedAt,
        expandedNodes: expanded,
        generatedNodes: generated,
      },
      conflicts: [],
      failureReason,
    };
  }

  function finish(base: SolverResult): SolverResult {
    const beforeTrace = mergeWarnings(base.warnings, warnings);
    const eventResult: SolverResult = {
      ...base,
      ...(beforeTrace.length > 0 ? { warnings: beforeTrace } : {}),
    };
    emit({ type: "finish", result: eventResult });
    const allWarnings = mergeWarnings(beforeTrace, recorder.warnings);
    return {
      ...eventResult,
      ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
      ...(options.traceLevel === "off" ? {} : { trace: recorder.events }),
    };
  }
}

export function validatePibtScenario(
  scenario: Scenario,
): { readonly code: "invalid-scenario" | "unsupported-rules"; readonly message: string } | null {
  if (scenario.kind !== "one-shot-mapf") {
    return {
      code: "unsupported-rules",
      message: "このブラウザ版 PIBT / winPIBT は one-shot MAPF のみに対応します。",
    };
  }
  if (scenario.rules.allowDiagonal || scenario.rules.forbidFollowing) {
    return {
      code: "unsupported-rules",
      message:
        "PIBT / winPIBT は 4 近傍かつ following conflict を許す原論文モデルだけに対応します。",
    };
  }
  if (scenario.rules.goalBehavior !== "stay") {
    return {
      code: "unsupported-rules",
      message:
        "one-shot PIBT / winPIBT は simultaneous goal configuration 後に goal へ留まる設定だけに対応します。",
    };
  }
  if (scenario.agents.length === 0) {
    return { code: "invalid-scenario", message: "エージェントが 1 体もありません。" };
  }
  const ids = new Set<string>();
  const starts = new Set<string>();
  for (const agent of scenario.agents) {
    if (ids.has(agent.id)) {
      return { code: "invalid-scenario", message: `agent ID ${agent.id} が重複しています。` };
    }
    ids.add(agent.id);
    if (!agent.goal) {
      return { code: "invalid-scenario", message: `${agent.id} に goal がありません。` };
    }
    if (!isWalkable(scenario.map, agent.start) || !isWalkable(scenario.map, agent.goal)) {
      return {
        code: "invalid-scenario",
        message: `${agent.id} の start または goal が通行不能です。`,
      };
    }
    const key = cellKey(agent.start);
    if (starts.has(key)) {
      return { code: "invalid-scenario", message: "複数 agent の start が重複しています。" };
    }
    starts.add(key);
  }
  return null;
}

export function resolveMaxTimesteps(
  scenario: Scenario,
  options: SolverOptions,
): { readonly value: number } | { readonly error: string } {
  const raw = options.extra?.maxTimesteps ?? options.horizon;
  const fallback = Math.min(
    options.maxHorizon,
    Math.max(64, scenario.map.width * scenario.map.height * scenario.agents.length),
  );
  if (raw === undefined) return { value: fallback };
  if (!Number.isInteger(raw) || typeof raw !== "number" || raw < 1 || raw > options.maxHorizon) {
    return { error: `maxTimesteps は 1..${options.maxHorizon} の整数で指定してください。` };
  }
  return { value: raw };
}

export function shuffledIndices(length: number, random: () => number): number[] {
  const values = Array.from({ length }, (_, index) => index);
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [values[index], values[target]] = [values[target]!, values[index]!];
  }
  return values;
}

function atGoalConfiguration(
  positions: readonly Cell[],
  agents: readonly (AgentSpec & { readonly goal: Cell })[],
): boolean {
  return agents.every((agent, index) => cellEquals(positions[index]!, agent.goal));
}

function isConflictFreeTransition(
  from: readonly Cell[],
  to: readonly Cell[],
  forbidEdgeSwap: boolean,
): boolean {
  const occupied = new Set<string>();
  for (const cell of to) {
    const key = cellKey(cell);
    if (occupied.has(key)) return false;
    occupied.add(key);
  }
  if (!forbidEdgeSwap) return true;
  for (let first = 0; first < to.length; first += 1) {
    for (let second = first + 1; second < to.length; second += 1) {
      if (
        !cellEquals(from[first]!, to[first]!) &&
        cellEquals(from[first]!, to[second]!) &&
        cellEquals(from[second]!, to[first]!)
      ) {
        return false;
      }
    }
  }
  return true;
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
