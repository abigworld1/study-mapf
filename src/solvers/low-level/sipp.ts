import type {
  AgentId,
  Cell,
  GridMap,
  ReservationTable,
  SimulationRules,
  Time,
  TimedPath,
  TimedPosition,
} from "@/lib/model/types.js";
import {
  cellEquals,
  cellKey,
  lookupDistance,
  neighbors,
  trueDistanceFrom,
} from "@/lib/model/grid.js";
import type { LowLevelStopReason } from "./space-time-astar.js";

export interface SafeInterval {
  readonly start: Time;
  readonly end: Time;
}

export interface SippInput {
  readonly map: GridMap;
  readonly start: Cell;
  readonly goal: Cell;
  readonly agentId: AgentId;
  readonly rules: SimulationRules;
  readonly reservations?: ReservationTable;
  readonly startTime?: Time;
  readonly maxTime: Time;
  readonly maxExpansions: number;
  readonly consumeExpansion?: () => "ok" | LowLevelStopReason;
  readonly heuristic?: Float64Array | ((cell: Cell) => number);
  readonly onExpand?: (cell: Cell, interval: SafeInterval, time: Time, f: number) => void;
  readonly onDiscoverInterval?: (cell: Cell, interval: SafeInterval) => void;
  readonly onReject?: (
    cell: Cell,
    time: Time,
    reason: "vertex" | "edge-swap" | "following",
  ) => void;
}

export interface SippOutput {
  readonly path: TimedPath | null;
  readonly expanded: number;
  readonly generated: number;
  readonly safeIntervalsDiscovered: number;
  readonly reason?: "no-path" | "max-time" | LowLevelStopReason;
}

interface SippNode {
  readonly cell: Cell;
  readonly intervalIndex: number;
  readonly interval: SafeInterval;
  /** この safe interval への最早到着時刻。状態同一性には含めない。 */
  readonly time: Time;
  readonly f: number;
  readonly sequence: number;
  readonly parent: SippNode | null;
}

/**
 * sipp-icra-2011, Figures 4-5 の独立再実装。
 * configuration と safe interval を状態、到着時刻を従属値として保持する。
 */
export function sippSearch(input: SippInput): SippOutput {
  const startTime = input.startTime ?? 0;
  const fallbackHeuristic = input.heuristic ?? trueDistanceFrom(input.map, input.goal);
  const heuristicAt =
    typeof fallbackHeuristic === "function"
      ? fallbackHeuristic
      : (cell: Cell) => lookupDistance(input.map, fallbackHeuristic, cell);

  const intervalCache = new Map<string, readonly SafeInterval[]>();
  let safeIntervalsDiscovered = 0;
  const intervalsAt = (cell: Cell): readonly SafeInterval[] => {
    const key = cellKey(cell);
    const cached = intervalCache.get(key);
    if (cached) return cached;
    const intervals = buildSafeIntervals(input, cell);
    intervalCache.set(key, intervals);
    for (const interval of intervals) {
      safeIntervalsDiscovered += 1;
      input.onDiscoverInterval?.(cell, interval);
    }
    return intervals;
  };

  const startIntervals = intervalsAt(input.start);
  const startIntervalIndex = startIntervals.findIndex(
    (interval) => interval.start <= startTime && startTime <= interval.end,
  );
  const startH = heuristicAt(input.start);
  if (startIntervalIndex < 0 || !Number.isFinite(startH)) {
    input.onReject?.(input.start, startTime, "vertex");
    return {
      path: null,
      expanded: 0,
      generated: 0,
      safeIntervalsDiscovered,
      reason: "no-path",
    };
  }

  const startInterval = startIntervals[startIntervalIndex]!;
  let nextSequence = 1;
  const root: SippNode = {
    cell: input.start,
    intervalIndex: startIntervalIndex,
    interval: startInterval,
    time: startTime,
    f: startTime + startH,
    sequence: 0,
    parent: null,
  };
  const open: SippNode[] = [root];
  const bestArrival = new Map<string, Time>([[stateKey(root.cell, root.intervalIndex), startTime]]);
  let expanded = 0;
  let generated = 1;
  let reachedTimeLimit = false;

  while (open.length > 0) {
    const index = findBestIndex(open);
    const current = open.splice(index, 1)[0]!;
    if (bestArrival.get(stateKey(current.cell, current.intervalIndex)) !== current.time) continue;

    const stop = consumeExpansion();
    if (stop !== "ok") {
      return {
        path: null,
        expanded,
        generated,
        safeIntervalsDiscovered,
        reason: stop,
      };
    }
    expanded += 1;
    input.onExpand?.(current.cell, current.interval, current.time, current.f);

    if (
      cellEquals(current.cell, input.goal) &&
      (input.rules.goalBehavior === "disappear" || current.interval.end >= input.maxTime)
    ) {
      return {
        path: reconstruct(input.agentId, current),
        expanded,
        generated,
        safeIntervalsDiscovered,
      };
    }

    if (current.time >= input.maxTime) {
      reachedTimeLimit = true;
      continue;
    }

    for (const nextCell of neighbors(input.map, current.cell, input.rules)) {
      const nextIntervals = intervalsAt(nextCell);
      for (let intervalIndex = 0; intervalIndex < nextIntervals.length; intervalIndex += 1) {
        const interval = nextIntervals[intervalIndex]!;
        const latestArrival = Math.min(interval.end, current.interval.end + 1, input.maxTime);
        let arrival = Math.max(current.time + 1, interval.start);
        if (arrival > latestArrival) continue;

        while (arrival <= latestArrival) {
          const rejection = transitionRejection(current.cell, nextCell, arrival);
          if (!rejection) break;
          input.onReject?.(nextCell, arrival, rejection);
          arrival += 1;
        }
        if (arrival > latestArrival) continue;

        const h = heuristicAt(nextCell);
        if (!Number.isFinite(h)) continue;
        const key = stateKey(nextCell, intervalIndex);
        const known = bestArrival.get(key);
        if (known !== undefined && known <= arrival) continue;

        bestArrival.set(key, arrival);
        open.push({
          cell: nextCell,
          intervalIndex,
          interval,
          time: arrival,
          f: arrival + h,
          sequence: nextSequence,
          parent: current,
        });
        nextSequence += 1;
        generated += 1;
      }
    }
  }

  return {
    path: null,
    expanded,
    generated,
    safeIntervalsDiscovered,
    reason: reachedTimeLimit ? "max-time" : "no-path",
  };

  function consumeExpansion(): "ok" | LowLevelStopReason {
    if (input.consumeExpansion) return input.consumeExpansion();
    return expanded >= input.maxExpansions ? "max-expansions" : "ok";
  }

  function transitionRejection(
    from: Cell,
    to: Cell,
    arrival: Time,
  ): "edge-swap" | "following" | null {
    const reservations = input.reservations;
    if (!reservations) return null;
    if (
      input.rules.forbidEdgeSwap &&
      reservations.isEdgeReserved(from, to, arrival, input.agentId)
    ) {
      return "edge-swap";
    }
    if (input.rules.forbidFollowing && reservations.isReserved(to, arrival - 1, input.agentId)) {
      return "following";
    }
    return null;
  }
}

/** 指定 cell の [0,maxTime] を予約の補集合へ分解する。 */
export function buildSafeIntervals(input: SippInput, cell: Cell): readonly SafeInterval[] {
  const intervals: SafeInterval[] = [];
  let intervalStart: Time | null = null;
  for (let time = 0; time <= input.maxTime; time += 1) {
    const safe = !input.reservations?.isReserved(cell, time, input.agentId);
    if (safe && intervalStart === null) intervalStart = time;
    if (!safe && intervalStart !== null) {
      intervals.push({ start: intervalStart, end: time - 1 });
      intervalStart = null;
    }
  }
  if (intervalStart !== null) intervals.push({ start: intervalStart, end: input.maxTime });
  return intervals;
}

function stateKey(cell: Cell, intervalIndex: number): string {
  return `${cell.x},${cell.y}#${intervalIndex}`;
}

function findBestIndex(open: readonly SippNode[]): number {
  let bestIndex = 0;
  for (let index = 1; index < open.length; index += 1) {
    const candidate = open[index]!;
    const best = open[bestIndex]!;
    if (
      candidate.f < best.f ||
      (candidate.f === best.f && candidate.time < best.time) ||
      (candidate.f === best.f && candidate.time === best.time && candidate.cell.y < best.cell.y) ||
      (candidate.f === best.f &&
        candidate.time === best.time &&
        candidate.cell.y === best.cell.y &&
        candidate.cell.x < best.cell.x) ||
      (candidate.f === best.f &&
        candidate.time === best.time &&
        candidate.cell.y === best.cell.y &&
        candidate.cell.x === best.cell.x &&
        candidate.interval.start < best.interval.start) ||
      (candidate.f === best.f &&
        candidate.time === best.time &&
        candidate.cell.y === best.cell.y &&
        candidate.cell.x === best.cell.x &&
        candidate.interval.start === best.interval.start &&
        candidate.sequence < best.sequence)
    ) {
      bestIndex = index;
    }
  }
  return bestIndex;
}

function reconstruct(agentId: AgentId, goalNode: SippNode): TimedPath {
  const nodes: SippNode[] = [];
  let node: SippNode | null = goalNode;
  while (node) {
    nodes.push(node);
    node = node.parent;
  }
  nodes.reverse();

  const first = nodes[0]!;
  const positions: TimedPosition[] = [{ time: first.time, cell: first.cell }];
  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1]!;
    const current = nodes[index]!;
    for (let time = previous.time + 1; time < current.time; time += 1) {
      positions.push({ time, cell: previous.cell });
    }
    positions.push({ time: current.time, cell: current.cell });
  }
  return { agentId, positions };
}
