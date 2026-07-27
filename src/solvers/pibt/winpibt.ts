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
  lookupDistance,
  movesWithWait,
  trueDistanceFrom,
} from "@/lib/model/grid.js";
import { MinHeap } from "../cbs/heap.js";
import { createTraceRecorder } from "../context.js";
import { checkLimits } from "../limits.js";
import { buildResult, checkAbort } from "../shared.js";
import { resolveMaxTimesteps, shuffledIndices, validatePibtScenario } from "./pibt.js";

type StopState = "timeout" | "aborted" | "node-limit" | null;

interface WindowSearchNode {
  readonly cell: Cell;
  readonly time: number;
  readonly g: number;
  readonly h: number;
  readonly f: number;
  readonly occupancyPenalty: number;
  readonly sequence: number;
  readonly parent: WindowSearchNode | null;
}

interface IdealPathResult {
  readonly path: readonly Cell[] | null;
  readonly reason?: "no-path" | StopState;
}

export const winPibtSolver: MapfSolver = {
  metadata: {
    id: "winpibt",
    displayName: "winPIBT（窓付き PIBT）",
    originalName: "windowed PIBT",
    category: "pibt-lacam",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: ["allowDiagonal", "forbidFollowing", "goalBehavior"],
    basedOnPaperIds: ["winpibt-2019", "pibt-aij-2022"],
    implementationNote:
      "winPIBT Algorithms 1–2 の centralized provisional paths、disentangled 制約、retroactive priority inheritance を実装。fixed common window と one-shot goal のみで、iterative task allocation は未対応。",
  },

  async solve(scenario, options, context): Promise<SolverResult> {
    return solveWinPibt(scenario, options, context);
  },
};

async function solveWinPibt(
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
            message: "winPIBT は suboptimalityFactor を使用しません。",
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
  let replans = 0;
  let stopState: StopState = null;

  if (!limitCheck.ok) return finish(limitCheck.result!);
  const validation = validatePibtScenario(scenario);
  if (validation) return finish(errorResult(validation.message, validation.code));

  const windowResult = resolveWindowSize(options);
  if ("error" in windowResult) {
    return finish(errorResult(windowResult.error, "invalid-scenario"));
  }
  const windowSize = windowResult.value;
  const maxTimestepsResult = resolveMaxTimesteps(scenario, options);
  if ("error" in maxTimestepsResult) {
    return finish(errorResult(maxTimestepsResult.error, "invalid-scenario"));
  }
  const maxTimesteps = maxTimestepsResult.value;
  const agents = scenario.agents as readonly (AgentSpec & { readonly goal: Cell })[];
  const distances = agents.map((agent) => trueDistanceFrom(scenario.map, agent.goal));
  for (let index = 0; index < agents.length; index += 1) {
    if (!Number.isFinite(lookupDistance(scenario.map, distances[index]!, agents[index]!.start))) {
      return finish(failureResult("no-solution", "unreachable-goal"));
    }
  }

  const epsilonOrder = shuffledIndices(agents.length, context.random);
  const epsilons = new Array<number>(agents.length);
  for (let rank = 0; rank < epsilonOrder.length; rank += 1) {
    epsilons[epsilonOrder[rank]!] = (rank + 1) / (agents.length + 1);
  }
  const tieRanks = agents.map(() =>
    Array.from({ length: scenario.map.width * scenario.map.height }, () => context.random()),
  );
  const eta = new Array<number>(agents.length).fill(0);
  const committed: Cell[][] = agents.map((agent) => [{ ...agent.start }]);
  const provisional: Cell[][] = committed.map((path) => [...path]);

  if (isGoalConfiguration(committed, 0, agents)) return solvedResult(0);

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

    let kappa = 0;
    for (let rank = 0; rank < order.length; rank += 1) {
      const agentIndex = order[rank]!;
      if (lastTime(agentIndex) <= time) {
        const requested = Math.min(time + windowSize, maxTimesteps, options.maxHorizon);
        const alpha = rank === 0 ? requested : Math.min(requested, kappa);
        secure(agentIndex, alpha, new Set<number>());
        const stopped = stopResultIfNeeded();
        if (stopped) return finish(stopped);
      }
      if (rank === 0) kappa = lastTime(agentIndex);
      else kappa = Math.min(kappa, lastTime(agentIndex));
    }

    const nextTime = time + 1;
    if (committed.some((path) => path[nextTime] === undefined)) {
      return finish(internalError("winPIBT Algorithm 2 が全 agent の次時刻を確保しませんでした。"));
    }
    const previous = committed.map((path) => path[time]!);
    const current = committed.map((path) => path[nextTime]!);
    if (!isConflictFreeTransition(previous, current, scenario.rules.forbidEdgeSwap)) {
      return finish(
        internalError("winPIBT の committed paths が disentangled invariant を破りました。"),
      );
    }

    const positions: Record<string, Cell> = {};
    for (let index = 0; index < agents.length; index += 1) {
      positions[agents[index]!.id] = current[index]!;
      eta[index] = cellEquals(current[index]!, agents[index]!.goal) ? 0 : eta[index]! + 1;
    }
    emit({ type: "move", time: nextTime, positions });
    emit({
      type: "progress",
      ratio: Math.min(1, nextTime / maxTimesteps),
      label: `winPIBT timestep ${nextTime} / window ${windowSize}`,
    });

    if (isGoalConfiguration(committed, nextTime, agents)) return solvedResult(nextTime);
  }

  warnings.push({
    code: "simplified-behavior",
    message: `winPIBT は ${maxTimesteps} timestep 以内に simultaneous goal configuration へ到達しませんでした。deadlock / livelock を含み、解不存在の証明ではありません。`,
  });
  return finish(failureResult("no-solution", "search-exhausted"));

  /** winpibt-2019 Algorithm 1 の centralized recursive call。 */
  function secure(agentIndex: number, alpha: number, requesting: ReadonlySet<number>): boolean {
    if (lastTime(agentIndex) >= alpha) return true;
    if (consumeExpansion() !== "ok") return false;

    const beta = Math.max(alpha, ...provisional.map((path) => path.length - 1));
    let ideal = findIdealPath(agentIndex, beta);
    if (!ideal.path) {
      if (stopState) return false;
      copeStuck(agentIndex, alpha);
      emit({ type: "backtrack", agentId: agents[agentIndex]!.id });
      return false;
    }
    provisional[agentIndex] = ideal.path.slice(0, alpha + 1) as Cell[];
    const activeRequesters = new Set(requesting);
    activeRequesters.add(agentIndex);

    while (lastTime(agentIndex) < alpha) {
      const ell = lastTime(agentIndex);
      const target = provisional[agentIndex]![ell + 1];
      if (!target) {
        stopState = "node-limit";
        return false;
      }

      while (true) {
        const shorter = findEndpointOccupant(target, (other) => lastTime(other) < ell, agentIndex);
        if (shorter === undefined) break;
        emit({
          type: "inherit-priority",
          from: agents[agentIndex]!.id,
          to: agents[shorter]!.id,
        });
        const before = lastTime(shorter);
        secure(shorter, before + 1, activeRequesters);
        if (stopState) return false;
        if (lastTime(shorter) <= before) {
          stopState = "node-limit";
          return false;
        }
      }

      const sameTime = findEndpointOccupant(target, (other) => lastTime(other) === ell, agentIndex);
      if (sameTime !== undefined && !activeRequesters.has(sameTime)) {
        emit({
          type: "inherit-priority",
          from: agents[agentIndex]!.id,
          to: agents[sameTime]!.id,
        });
        if (!secure(sameTime, ell + 1, activeRequesters)) {
          if (stopState) return false;
          provisional[agentIndex] = [...committed[agentIndex]!];
          replans += 1;
          emit({ type: "backtrack", agentId: agents[agentIndex]!.id });
          emit({
            type: "replan",
            agentIds: [agents[agentIndex]!.id],
            reason: "winPIBT suffix revoke",
          });
          ideal = findIdealPath(agentIndex, beta);
          if (!ideal.path) {
            if (stopState) return false;
            copeStuck(agentIndex, alpha);
            return false;
          }
          provisional[agentIndex] = ideal.path.slice(0, alpha + 1) as Cell[];
          continue;
        }
      }

      committed[agentIndex]!.push(target);
      emit({
        type: "reserve",
        agentId: agents[agentIndex]!.id,
        cell: target,
        time: ell + 1,
      });
    }
    provisional[agentIndex] = [...committed[agentIndex]!];
    return true;
  }

  /** validPath + registerPath。beta までの time-expanded A* を独立実装する。 */
  function findIdealPath(agentIndex: number, beta: number): IdealPathResult {
    const startTime = lastTime(agentIndex);
    const start = committed[agentIndex]![startTime]!;
    if (startTime >= beta) return { path: [...committed[agentIndex]!] };

    let nextSequence = 1;
    const rootH = lookupDistance(scenario.map, distances[agentIndex]!, start);
    const root: WindowSearchNode = {
      cell: start,
      time: startTime,
      g: 0,
      h: rootH,
      f: rootH,
      occupancyPenalty: 0,
      sequence: 0,
      parent: null,
    };
    const open = new MinHeap<WindowSearchNode>((left, right) =>
      compareWindowNodes(left, right, agentIndex),
    );
    const best = new Map<string, WindowSearchNode>();
    open.push(root);
    best.set(stateKey(start, startTime), root);
    generated += 1;

    while (open.size > 0) {
      const current = open.pop()!;
      if (best.get(stateKey(current.cell, current.time)) !== current) continue;
      if (consumeExpansion() !== "ok") return { path: null, reason: stopState };
      emit({
        type: "expand-node",
        agentId: agents[agentIndex]!.id,
        state: {
          phase: "winpibt-valid-path",
          cell: current.cell,
          time: current.time,
          beta,
          f: current.f,
        },
      });

      if (current.time === beta) {
        const suffix = reconstruct(current);
        const full = [...committed[agentIndex]!.slice(0, startTime), ...suffix];
        return { path: full };
      }

      const nextTime = current.time + 1;
      const candidates = movesWithWait(scenario.map, current.cell, scenario.rules)
        .filter((cell) =>
          Number.isFinite(lookupDistance(scenario.map, distances[agentIndex]!, cell)),
        )
        .sort((left, right) => {
          const leftDistance = lookupDistance(scenario.map, distances[agentIndex]!, left);
          const rightDistance = lookupDistance(scenario.map, distances[agentIndex]!, right);
          const leftOccupied = endpointOccupied(left, agentIndex) ? 1 : 0;
          const rightOccupied = endpointOccupied(right, agentIndex) ? 1 : 0;
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
        if (!isAllowedByProvisional(agentIndex, startTime, current.cell, candidate, nextTime)) {
          continue;
        }
        const h = lookupDistance(scenario.map, distances[agentIndex]!, candidate);
        const g = current.g + 1;
        const occupancyPenalty =
          current.occupancyPenalty + (endpointOccupied(candidate, agentIndex) ? 1 : 0);
        const key = stateKey(candidate, nextTime);
        const previous = best.get(key);
        if (previous && previous.occupancyPenalty <= occupancyPenalty) continue;
        const node: WindowSearchNode = {
          cell: candidate,
          time: nextTime,
          g,
          h,
          f: g + h,
          occupancyPenalty,
          sequence: nextSequence,
          parent: current,
        };
        nextSequence += 1;
        generated += 1;
        best.set(key, node);
        open.push(node);
      }
    }
    return { path: null, reason: "no-path" };
  }

  function isAllowedByProvisional(
    agentIndex: number,
    baseTime: number,
    from: Cell,
    to: Cell,
    time: number,
  ): boolean {
    for (let other = 0; other < agents.length; other += 1) {
      if (other === agentIndex) continue;
      const path = provisional[other]!;
      const otherEnd = path.length - 1;
      const simultaneous = path[time];
      if (simultaneous && cellEquals(to, simultaneous)) return false;
      if (scenario.rules.forbidEdgeSwap && time > 0) {
        const otherPrevious = path[time - 1];
        if (
          otherPrevious &&
          simultaneous &&
          !cellEquals(from, to) &&
          cellEquals(from, simultaneous) &&
          cellEquals(to, otherPrevious)
        ) {
          return false;
        }
      }

      // winpibt-2019 p.5: shorter provisional path cannot enter a cell that a
      // longer path will use later in the gap; this preserves disentangled paths.
      if (baseTime < time && time < otherEnd) {
        for (let future = time + 1; future <= otherEnd; future += 1) {
          if (cellEquals(to, path[future]!)) return false;
        }
      }
    }
    return true;
  }

  function copeStuck(agentIndex: number, alpha: number): void {
    provisional[agentIndex] = [...committed[agentIndex]!];
    while (lastTime(agentIndex) < alpha) {
      const time = lastTime(agentIndex) + 1;
      const wait = committed[agentIndex]![time - 1]!;
      committed[agentIndex]!.push(wait);
      provisional[agentIndex]!.push(wait);
      emit({ type: "reserve", agentId: agents[agentIndex]!.id, cell: wait, time });
    }
  }

  function findEndpointOccupant(
    cell: Cell,
    predicate: (other: number) => boolean,
    except: number,
  ): number | undefined {
    for (let other = 0; other < agents.length; other += 1) {
      if (other === except || !predicate(other)) continue;
      const endpoint = committed[other]![lastTime(other)]!;
      if (cellEquals(endpoint, cell)) return other;
    }
    return undefined;
  }

  function endpointOccupied(cell: Cell, except: number): boolean {
    return findEndpointOccupant(cell, () => true, except) !== undefined;
  }

  function lastTime(agentIndex: number): number {
    return committed[agentIndex]!.length - 1;
  }

  function compareWindowNodes(
    left: WindowSearchNode,
    right: WindowSearchNode,
    agentIndex: number,
  ): number {
    return (
      left.f - right.f ||
      left.occupancyPenalty - right.occupancyPenalty ||
      right.g - left.g ||
      tieRanks[agentIndex]![cellIndex(scenario.map, left.cell)]! -
        tieRanks[agentIndex]![cellIndex(scenario.map, right.cell)]! ||
      cellIndex(scenario.map, left.cell) - cellIndex(scenario.map, right.cell) ||
      left.sequence - right.sequence
    );
  }

  function reconstruct(goal: WindowSearchNode): Cell[] {
    const out: Cell[] = [];
    let current: WindowSearchNode | null = goal;
    while (current) {
      out.push(current.cell);
      current = current.parent;
    }
    out.reverse();
    return out;
  }

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

  function solvedResult(horizon: number): SolverResult {
    const paths: TimedPath[] = agents.map((agent, index) => ({
      agentId: agent.id,
      positions: committed[index]!.slice(0, horizon + 1).map((cell, time) => ({ time, cell })),
    }));
    const result = buildResult(scenario, paths, context.now() - startedAt, expanded, "solved", {
      generatedNodes: generated,
      replans,
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
        replans,
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

function resolveWindowSize(
  options: SolverOptions,
): { readonly value: number } | { readonly error: string } {
  const raw = options.extra?.windowSize ?? 5;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > options.maxHorizon) {
    return { error: `windowSize は 1..${options.maxHorizon} の整数で指定してください。` };
  }
  return { value: raw };
}

function isGoalConfiguration(
  paths: readonly (readonly Cell[])[],
  time: number,
  agents: readonly (AgentSpec & { readonly goal: Cell })[],
): boolean {
  return agents.every((agent, index) => {
    const path = paths[index]!;
    const cell = path[Math.min(time, path.length - 1)]!;
    return cellEquals(cell, agent.goal);
  });
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

function stateKey(cell: Cell, time: number): string {
  return `${cell.x},${cell.y}@${time}`;
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
