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
import { cellEquals, movesWithWait } from "@/lib/model/grid.js";
import type { LowLevelStopReason } from "./space-time-astar.js";

export interface WindowedSpaceTimeAStarInput {
  readonly map: GridMap;
  readonly start: Cell;
  readonly goal: Cell;
  readonly agentId: AgentId;
  readonly rules: SimulationRules;
  readonly reservations: ReservationTable;
  readonly startTime: Time;
  readonly windowEnd: Time;
  readonly maxExpansions: number;
  readonly heuristic: (cell: Cell) => number;
  readonly consumeExpansion?: () => "ok" | LowLevelStopReason;
  readonly onExpand?: (cell: Cell, time: Time, f: number) => void;
  readonly onReject?: (
    cell: Cell,
    time: Time,
    reason: "vertex" | "edge-swap" | "following",
  ) => void;
}

export interface WindowedSpaceTimeAStarOutput {
  readonly path: TimedPath | null;
  readonly reachedGoal: boolean;
  readonly expanded: number;
  readonly generated: number;
  readonly reason?: "no-path" | LowLevelStopReason;
}

interface Node {
  readonly cell: Cell;
  readonly time: Time;
  readonly g: number;
  readonly h: number;
  readonly f: number;
  readonly sequence: number;
  readonly parent: Node | null;
}

/**
 * WHCA* の window 内探索。
 * windowEnd の仮想 terminal edge に abstract distance を加えた評価で部分経路を選ぶ。
 */
export function windowedSpaceTimeAStar(
  input: WindowedSpaceTimeAStarInput,
): WindowedSpaceTimeAStarOutput {
  const startH = input.heuristic(input.start);
  if (!Number.isFinite(startH)) {
    return { path: null, reachedGoal: false, expanded: 0, generated: 0, reason: "no-path" };
  }
  if (input.reservations.isReserved(input.start, input.startTime, input.agentId)) {
    input.onReject?.(input.start, input.startTime, "vertex");
    return { path: null, reachedGoal: false, expanded: 0, generated: 0, reason: "no-path" };
  }

  let nextSequence = 1;
  const root: Node = {
    cell: input.start,
    time: input.startTime,
    g: 0,
    h: startH,
    f: startH,
    sequence: 0,
    parent: null,
  };
  const open: Node[] = [root];
  const best = new Map<string, number>([[key(root.cell, root.time), 0]]);
  let expanded = 0;
  let generated = 1;

  while (open.length > 0) {
    const index = findBestIndex(open);
    const current = open.splice(index, 1)[0]!;
    if (best.get(key(current.cell, current.time)) !== current.g) continue;

    const stop = consumeExpansion();
    if (stop !== "ok") {
      return { path: null, reachedGoal: false, expanded, generated, reason: stop };
    }
    expanded += 1;
    input.onExpand?.(current.cell, current.time, current.f);

    if (cellEquals(current.cell, input.goal) && canRemainAtGoal(current.time)) {
      return {
        path: reconstruct(input.agentId, current),
        reachedGoal: true,
        expanded,
        generated,
      };
    }
    if (current.time >= input.windowEnd) {
      return {
        path: reconstruct(input.agentId, current),
        reachedGoal: false,
        expanded,
        generated,
      };
    }

    const nextTime = current.time + 1;
    const candidates =
      input.rules.goalBehavior === "stay" && cellEquals(current.cell, input.goal)
        ? [current.cell]
        : movesWithWait(input.map, current.cell, input.rules);
    for (const next of candidates) {
      const rejection = reservationRejection(current.cell, next, nextTime);
      if (rejection) {
        input.onReject?.(next, nextTime, rejection);
        continue;
      }
      const h = input.heuristic(next);
      if (!Number.isFinite(h)) continue;
      const stepCost = cellEquals(current.cell, input.goal) && cellEquals(next, input.goal) ? 0 : 1;
      const g = current.g + stepCost;
      const stateKey = key(next, nextTime);
      const known = best.get(stateKey);
      if (known !== undefined && known <= g) continue;
      best.set(stateKey, g);
      open.push({
        cell: next,
        time: nextTime,
        g,
        h,
        f: g + h,
        sequence: nextSequence,
        parent: current,
      });
      nextSequence += 1;
      generated += 1;
    }
  }

  return { path: null, reachedGoal: false, expanded, generated, reason: "no-path" };

  function consumeExpansion(): "ok" | LowLevelStopReason {
    if (input.consumeExpansion) return input.consumeExpansion();
    return expanded >= input.maxExpansions ? "max-expansions" : "ok";
  }

  function reservationRejection(
    from: Cell,
    to: Cell,
    time: Time,
  ): "vertex" | "edge-swap" | "following" | null {
    if (input.reservations.isReserved(to, time, input.agentId)) return "vertex";
    if (
      input.rules.forbidEdgeSwap &&
      input.reservations.isEdgeReserved(from, to, time, input.agentId)
    ) {
      return "edge-swap";
    }
    if (
      input.rules.forbidFollowing &&
      !cellEquals(from, to) &&
      input.reservations.isReserved(to, time - 1, input.agentId)
    ) {
      return "following";
    }
    return null;
  }

  function canRemainAtGoal(from: Time): boolean {
    if (input.rules.goalBehavior === "disappear") return true;
    for (let time = from + 1; time <= input.windowEnd; time += 1) {
      if (input.reservations.isReserved(input.goal, time, input.agentId)) return false;
    }
    return true;
  }
}

function key(cell: Cell, time: Time): string {
  return `${cell.x},${cell.y}@${time}`;
}

function findBestIndex(open: readonly Node[]): number {
  let bestIndex = 0;
  for (let index = 1; index < open.length; index += 1) {
    const candidate = open[index]!;
    const best = open[bestIndex]!;
    if (
      candidate.f < best.f ||
      (candidate.f === best.f && candidate.h < best.h) ||
      (candidate.f === best.f && candidate.h === best.h && candidate.g > best.g) ||
      (candidate.f === best.f &&
        candidate.h === best.h &&
        candidate.g === best.g &&
        candidate.sequence < best.sequence)
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
