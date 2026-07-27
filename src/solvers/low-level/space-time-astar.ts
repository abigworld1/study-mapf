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
import { cellEquals, lookupDistance, movesWithWait, trueDistanceFrom } from "@/lib/model/grid.js";

export type LowLevelStopReason = "max-expansions" | "timeout" | "aborted";

/**
 * 時空間 A* の入力。
 *
 * cooperative-pathfinding-2005, Cooperative A* 節の独立再実装。
 * 状態は (cell, time) で、予約表に記録された占有を動的障害物として扱う。
 */
export interface SpaceTimeAStarInput {
  readonly map: GridMap;
  readonly start: Cell;
  readonly goal: Cell;
  readonly agentId: AgentId;
  readonly rules: SimulationRules;
  readonly reservations?: ReservationTable;
  /** 予約表を確認する最後の絶対時刻。 */
  readonly reservationHorizon?: Time;
  /** 探索開始の絶対時刻。WHCA* の再計画では 0 以外になる。 */
  readonly startTime?: Time;
  /** 探索する最後の絶対時刻。 */
  readonly maxTime: Time;
  readonly maxExpansions: number;
  readonly onExpand?: (cell: Cell, time: Time, f: number) => void;
  readonly onReject?: (
    cell: Cell,
    time: Time,
    reason: "vertex" | "edge-swap" | "following",
  ) => void;
  /** 複数探索で展開予算を共有するときに使う。ok のときだけ 1 展開を消費済み。 */
  readonly consumeExpansion?: () => "ok" | LowLevelStopReason;
  /** Float64Array は map index、関数は HCA* の on-demand RRA* 用。 */
  readonly heuristic?: Float64Array | ((cell: Cell) => number);
}

export interface SpaceTimeAStarOutput {
  readonly path: TimedPath | null;
  readonly expanded: number;
  readonly generated: number;
  readonly reason?: "no-path" | "max-time" | LowLevelStopReason;
}

interface Node {
  readonly cell: Cell;
  readonly time: Time;
  readonly g: number;
  readonly f: number;
  readonly sequence: number;
  readonly parent: Node | null;
}

function nodeKey(cell: Cell, time: Time): string {
  return `${cell.x},${cell.y}@${time}`;
}

/**
 * 固定された予約表のもとで最短到着経路を探索する。
 *
 * タイブレークは f 昇順、g 降順、生成順。論文が同値順を指定しないため、
 * ブラウザ版の決定性を保つ規則として明示している。
 */
export function spaceTimeAStar(input: SpaceTimeAStarInput): SpaceTimeAStarOutput {
  const {
    map,
    start,
    goal,
    agentId,
    rules,
    reservations,
    maxTime,
    maxExpansions,
    onExpand,
    onReject,
  } = input;

  const startTime = input.startTime ?? 0;
  const horizon = input.reservationHorizon ?? maxTime;
  const fallbackHeuristic = input.heuristic ?? trueDistanceFrom(map, goal);
  const heuristicAt =
    typeof fallbackHeuristic === "function"
      ? fallbackHeuristic
      : (cell: Cell) => lookupDistance(map, fallbackHeuristic, cell);

  const startH = heuristicAt(start);
  if (!Number.isFinite(startH)) {
    return { path: null, expanded: 0, generated: 0, reason: "no-path" };
  }
  if (isVertexReserved(start, startTime)) {
    onReject?.(start, startTime, "vertex");
    return { path: null, expanded: 0, generated: 0, reason: "no-path" };
  }

  let nextSequence = 1;
  const open: Node[] = [
    {
      cell: start,
      time: startTime,
      g: 0,
      f: startH,
      sequence: 0,
      parent: null,
    },
  ];
  const best = new Map<string, number>([[nodeKey(start, startTime), 0]]);
  let expanded = 0;
  let generated = 1;
  let reachedTimeLimit = false;

  while (open.length > 0) {
    const bestIndex = findBestIndex(open);
    const current = open.splice(bestIndex, 1)[0]!;
    if (best.get(nodeKey(current.cell, current.time)) !== current.g) continue;

    const stop = consumeExpansion();
    if (stop !== "ok") {
      return { path: null, expanded, generated, reason: stop };
    }
    expanded += 1;
    onExpand?.(current.cell, current.time, current.f);

    if (cellEquals(current.cell, goal)) {
      if (rules.goalBehavior === "disappear" || canOccupyGoal(current.cell, current.time)) {
        return { path: reconstruct(agentId, current), expanded, generated };
      }
    }

    if (current.time >= maxTime) {
      reachedTimeLimit = true;
      continue;
    }

    const nextTime = current.time + 1;
    for (const next of movesWithWait(map, current.cell, rules)) {
      const rejection = reservationRejection(current.cell, next, nextTime);
      if (rejection) {
        onReject?.(next, nextTime, rejection);
        continue;
      }

      const h = heuristicAt(next);
      if (!Number.isFinite(h)) continue;
      const g = current.g + 1;
      const key = nodeKey(next, nextTime);
      const known = best.get(key);
      if (known !== undefined && known <= g) continue;

      best.set(key, g);
      open.push({
        cell: next,
        time: nextTime,
        g,
        f: g + h,
        sequence: nextSequence,
        parent: current,
      });
      nextSequence += 1;
      generated += 1;
    }
  }

  return {
    path: null,
    expanded,
    generated,
    reason: reachedTimeLimit ? "max-time" : "no-path",
  };

  function consumeExpansion(): "ok" | LowLevelStopReason {
    if (input.consumeExpansion) return input.consumeExpansion();
    return expanded >= maxExpansions ? "max-expansions" : "ok";
  }

  function isVertexReserved(cell: Cell, time: Time): boolean {
    return Boolean(reservations && time <= horizon && reservations.isReserved(cell, time, agentId));
  }

  function reservationRejection(
    from: Cell,
    to: Cell,
    time: Time,
  ): "vertex" | "edge-swap" | "following" | null {
    if (!reservations || time > horizon) return null;
    if (reservations.isReserved(to, time, agentId)) return "vertex";
    if (rules.forbidEdgeSwap && reservations.isEdgeReserved(from, to, time, agentId)) {
      return "edge-swap";
    }
    if (
      rules.forbidFollowing &&
      !cellEquals(from, to) &&
      reservations.isReserved(to, time - 1, agentId)
    ) {
      return "following";
    }
    return null;
  }

  function canOccupyGoal(cell: Cell, from: Time): boolean {
    if (!reservations) return true;
    for (let time = from + 1; time <= horizon; time += 1) {
      if (reservations.isReserved(cell, time, agentId)) {
        onReject?.(cell, time, "vertex");
        return false;
      }
    }
    return true;
  }
}

function findBestIndex(open: readonly Node[]): number {
  let bestIndex = 0;
  for (let index = 1; index < open.length; index += 1) {
    const candidate = open[index]!;
    const best = open[bestIndex]!;
    if (
      candidate.f < best.f ||
      (candidate.f === best.f && candidate.g > best.g) ||
      (candidate.f === best.f && candidate.g === best.g && candidate.sequence < best.sequence)
    ) {
      bestIndex = index;
    }
  }
  return bestIndex;
}

function reconstruct(agentId: AgentId, goalNode: Node): TimedPath {
  const positions: TimedPosition[] = [];
  let node: Node | null = goalNode;
  while (node) {
    positions.push({ time: node.time, cell: node.cell });
    node = node.parent;
  }
  positions.reverse();
  return { agentId, positions };
}
