import type {
  AgentSpec,
  Cell,
  GridMap,
  ReservationTable,
  SimulationRules,
  Time,
  TimedPath,
  TimedPosition,
} from "@/lib/model/types.js";
import { positionAt } from "@/lib/model/conflicts.js";
import { cellEquals, cellIndex, lookupDistance, movesWithWait } from "@/lib/model/grid.js";
import { MinHeap } from "../cbs/heap.js";
import type { LowLevelStopReason } from "../low-level/space-time-astar.js";

export interface PbsLowLevelInput {
  readonly map: GridMap;
  readonly agent: AgentSpec & { readonly goal: Cell };
  readonly rules: SimulationRules;
  readonly hardReservations: ReservationTable;
  readonly incomparablePaths: readonly TimedPath[];
  readonly lowerPaths: readonly TimedPath[];
  readonly heuristic: Float64Array;
  readonly maxTime: Time;
  readonly consumeExpansion: () => "ok" | LowLevelStopReason;
  readonly onExpand?: (
    cell: Cell,
    time: Time,
    f: number,
    incomparableConflicts: number,
    lowerConflicts: number,
  ) => void;
}

export interface PbsLowLevelOutput {
  readonly path: TimedPath | null;
  readonly expanded: number;
  readonly generated: number;
  readonly reason?: "no-path" | "max-time" | LowLevelStopReason;
}

interface SearchNode {
  readonly cell: Cell;
  readonly time: Time;
  readonly g: number;
  readonly h: number;
  readonly f: number;
  readonly incomparableConflicts: number;
  readonly lowerConflicts: number;
  readonly sequence: number;
  readonly parent: SearchNode | null;
  active: boolean;
}

interface SoftScore {
  readonly incomparable: number;
  readonly lower: number;
}

/**
 * PBS Algorithm 2 の low-level search。
 *
 * higher-priority paths は hard reservation、同じ最短長の中では論文 p.5 の
 * 指定どおり incomparable paths、lower-priority paths の順に CAT collision を
 * 最小化する。USC 公開実装のコードは転記せず、論文から独立実装している。
 */
export function pbsLowLevelAStar(input: PbsLowLevelInput): PbsLowLevelOutput {
  const { map, agent, rules, hardReservations, maxTime } = input;
  const startH = lookupDistance(map, input.heuristic, agent.start);
  if (!Number.isFinite(startH) || hardReservations.isReserved(agent.start, 0, agent.id)) {
    return { path: null, expanded: 0, generated: 0, reason: "no-path" };
  }

  const open = new MinHeap<SearchNode>((a, b) => compareNodes(a, b, map));
  const best = new Map<string, SearchNode>();
  const startSoft = softAtStart(agent.start);
  const root: SearchNode = {
    cell: agent.start,
    time: 0,
    g: 0,
    h: startH,
    f: startH,
    incomparableConflicts: startSoft.incomparable,
    lowerConflicts: startSoft.lower,
    sequence: 0,
    parent: null,
    active: true,
  };
  open.push(root);
  best.set(stateKey(agent.start, 0), root);

  let nextSequence = 1;
  let expanded = 0;
  let generated = 1;
  let reachedTimeLimit = false;

  while (open.size > 0) {
    const current = open.pop()!;
    if (!current.active || best.get(stateKey(current.cell, current.time)) !== current) continue;
    current.active = false;

    const stop = input.consumeExpansion();
    if (stop !== "ok") return { path: null, expanded, generated, reason: stop };
    expanded += 1;
    input.onExpand?.(
      current.cell,
      current.time,
      current.f,
      current.incomparableConflicts,
      current.lowerConflicts,
    );

    if (cellEquals(current.cell, agent.goal) && canStayAtGoal(current.time)) {
      return { path: reconstruct(agent.id, current), expanded, generated };
    }
    if (current.time >= maxTime) {
      reachedTimeLimit = true;
      continue;
    }

    const nextTime = current.time + 1;
    for (const next of movesWithWait(map, current.cell, rules)) {
      if (hardReservations.isReserved(next, nextTime, agent.id)) continue;
      if (
        rules.forbidEdgeSwap &&
        hardReservations.isEdgeReserved(current.cell, next, nextTime, agent.id)
      ) {
        continue;
      }

      const h = lookupDistance(map, input.heuristic, next);
      if (!Number.isFinite(h)) continue;
      const transition = transitionSoft(current.cell, next, nextTime);
      const incomparableConflicts = current.incomparableConflicts + transition.incomparable;
      const lowerConflicts = current.lowerConflicts + transition.lower;
      const key = stateKey(next, nextTime);
      const previous = best.get(key);
      if (
        previous &&
        lexicographicallyNoWorse(
          previous.incomparableConflicts,
          previous.lowerConflicts,
          incomparableConflicts,
          lowerConflicts,
        )
      ) {
        continue;
      }
      if (previous) previous.active = false;

      const node: SearchNode = {
        cell: next,
        time: nextTime,
        g: nextTime,
        h,
        f: nextTime + h,
        incomparableConflicts,
        lowerConflicts,
        sequence: nextSequence,
        parent: current,
        active: true,
      };
      nextSequence += 1;
      generated += 1;
      best.set(key, node);
      open.push(node);
    }
  }

  return {
    path: null,
    expanded,
    generated,
    reason: reachedTimeLimit ? "max-time" : "no-path",
  };

  function canStayAtGoal(from: Time): boolean {
    for (let time = from + 1; time <= maxTime; time += 1) {
      if (hardReservations.isReserved(agent.goal, time, agent.id)) return false;
    }
    return true;
  }

  function softAtStart(cell: Cell): SoftScore {
    return {
      incomparable: countVertex(input.incomparablePaths, cell, 0),
      lower: countVertex(input.lowerPaths, cell, 0),
    };
  }

  function transitionSoft(from: Cell, to: Cell, time: Time): SoftScore {
    return {
      incomparable: countTransition(input.incomparablePaths, from, to, time),
      lower: countTransition(input.lowerPaths, from, to, time),
    };
  }

  function countVertex(paths: readonly TimedPath[], cell: Cell, time: Time): number {
    let count = 0;
    for (const path of paths) {
      const other = positionAt(path, time, rules);
      if (other && cellEquals(cell, other)) count += 1;
    }
    return count;
  }

  function countTransition(paths: readonly TimedPath[], from: Cell, to: Cell, time: Time): number {
    let count = 0;
    for (const path of paths) {
      const previous = positionAt(path, time - 1, rules);
      const current = positionAt(path, time, rules);
      if (current && cellEquals(to, current)) count += 1;
      if (
        rules.forbidEdgeSwap &&
        previous &&
        current &&
        !cellEquals(from, to) &&
        cellEquals(from, current) &&
        cellEquals(to, previous)
      ) {
        count += 1;
      }
    }
    return count;
  }
}

function compareNodes(a: SearchNode, b: SearchNode, map: GridMap): number {
  return (
    a.f - b.f ||
    b.g - a.g ||
    a.incomparableConflicts - b.incomparableConflicts ||
    a.lowerConflicts - b.lowerConflicts ||
    cellIndex(map, a.cell) - cellIndex(map, b.cell) ||
    a.sequence - b.sequence
  );
}

function lexicographicallyNoWorse(
  leftIncomparable: number,
  leftLower: number,
  rightIncomparable: number,
  rightLower: number,
): boolean {
  return (
    leftIncomparable < rightIncomparable ||
    (leftIncomparable === rightIncomparable && leftLower <= rightLower)
  );
}

function stateKey(cell: Cell, time: Time): string {
  return `${cell.x},${cell.y}@${time}`;
}

function reconstruct(agentId: string, goal: SearchNode): TimedPath {
  const positions: TimedPosition[] = [];
  let node: SearchNode | null = goal;
  while (node) {
    positions.push({ time: node.time, cell: node.cell });
    node = node.parent;
  }
  positions.reverse();
  return { agentId, positions };
}
