import type {
  AgentSpec,
  Cell,
  Constraint,
  GridMap,
  SimulationRules,
  Time,
  TimedPath,
  TimedPosition,
} from "@/lib/model/types.js";
import { cellEquals, lookupDistance, movesWithWait, trueDistanceFrom } from "@/lib/model/grid.js";
import { positionAt } from "@/lib/model/conflicts.js";
import { MinHeap } from "./heap.js";
import {
  canWaitAtGoalUnderConstraints,
  violatesConstraintsAtVertex,
  violatesConstraintsOnTransition,
} from "./constraint-semantics.js";

export type CbsLowLevelStopReason = "node-limit" | "timeout" | "aborted";

export interface ConstrainedSearchInput {
  readonly map: GridMap;
  readonly agent: AgentSpec & { readonly goal: Cell };
  readonly rules: SimulationRules;
  readonly constraints: readonly Constraint[];
  /** CAT と focal secondary heuristic に使う、当該 agent 以外の path。 */
  readonly otherPaths: readonly TimedPath[];
  readonly weight: number;
  readonly maxTime: Time;
  readonly consumeExpansion: () => "ok" | CbsLowLevelStopReason;
  readonly onExpand?: (cell: Cell, time: Time, f: number, conflicts: number) => void;
}

export interface ConstrainedSearchOutput {
  readonly path: TimedPath | null;
  /** goal 選択時の OPEN 最小 f。bounded low level の admissible lower bound。 */
  readonly lowerBound?: number;
  readonly expanded: number;
  readonly generated: number;
  readonly reason?: "no-path" | "max-time" | CbsLowLevelStopReason;
}

interface SearchNode {
  readonly cell: Cell;
  readonly time: Time;
  readonly g: number;
  readonly h: number;
  readonly f: number;
  readonly conflictCount: number;
  readonly sequence: number;
  readonly parent: SearchNode | null;
  active: boolean;
  inFocal: boolean;
}

function stateKey(cell: Cell, time: Time): string {
  return `${cell.x},${cell.y}@${time}`;
}

/**
 * CBS 系の制約付き single-agent focal A*。
 *
 * weight=1 では最短 path を返し、同じ f の中だけ CAT conflict 数で tie-break する。
 * weight>1 では bcbs-ecbs-socs-2014 の focal-search(f,hc) になる。
 */
export function constrainedFocalAStar(input: ConstrainedSearchInput): ConstrainedSearchOutput {
  const { map, agent, rules, constraints, otherPaths, weight, maxTime } = input;
  const distance = trueDistanceFrom(map, agent.goal);
  const startH = lookupDistance(map, distance, agent.start);
  if (!Number.isFinite(startH) || violatesVertex(agent.start, 0)) {
    return { path: null, expanded: 0, generated: 0, reason: "no-path" };
  }

  const byF = new MinHeap<SearchNode>(compareByF);
  const notYetFocal = new MinHeap<SearchNode>(compareByF);
  const focal = new MinHeap<SearchNode>(compareFocal);
  const best = new Map<string, SearchNode>();
  let nextSequence = 1;
  let expanded = 0;
  let generated = 0;
  let reachedTimeLimit = false;

  const root: SearchNode = {
    cell: agent.start,
    time: 0,
    g: 0,
    h: startH,
    f: startH,
    conflictCount: conflictsAtStart(agent.start),
    sequence: 0,
    parent: null,
    active: true,
    inFocal: false,
  };
  addNode(root);

  while (true) {
    const lowerBoundNode = peekActive(byF);
    if (!lowerBoundNode) break;
    const lowerBound = lowerBoundNode.f;
    const threshold = weight * lowerBound + 1e-9;
    promoteEligible(threshold);

    const current = popActive(focal);
    if (!current) {
      // 浮動小数点の境界でも必ず f-min node は FOCAL に入る。
      promoteEligible(threshold + 1e-9);
    }
    const selected = current ?? popActive(focal);
    if (!selected) break;
    selected.active = false;
    const known = best.get(stateKey(selected.cell, selected.time));
    if (known !== selected) continue;

    const stop = input.consumeExpansion();
    if (stop !== "ok") {
      return { path: null, expanded, generated, reason: stop };
    }
    expanded += 1;
    input.onExpand?.(selected.cell, selected.time, selected.f, selected.conflictCount);

    if (cellEquals(selected.cell, agent.goal) && canStayAtGoal(selected.time)) {
      return {
        path: reconstruct(agent.id, selected),
        lowerBound,
        expanded,
        generated,
      };
    }

    if (selected.time >= maxTime) {
      reachedTimeLimit = true;
      continue;
    }

    const nextTime = selected.time + 1;
    for (const next of movesWithWait(map, selected.cell, rules)) {
      if (violatesVertex(next, nextTime) || violatesEdge(selected.cell, next, nextTime)) continue;
      const h = lookupDistance(map, distance, next);
      if (!Number.isFinite(h)) continue;
      const conflictCount =
        selected.conflictCount + transitionConflictCount(selected.cell, next, nextTime);
      const key = stateKey(next, nextTime);
      const previous = best.get(key);
      // 同じ (cell,time) なら以後の遷移候補と f は同じなので、CAT conflict 数が
      // 小さくない経路は、既に展開済みの経路に対しても支配される。
      if (previous && previous.conflictCount <= conflictCount) continue;
      if (previous) previous.active = false;

      const node: SearchNode = {
        cell: next,
        time: nextTime,
        g: nextTime,
        h,
        f: nextTime + h,
        conflictCount,
        sequence: nextSequence,
        parent: selected,
        active: true,
        inFocal: false,
      };
      nextSequence += 1;
      best.set(key, node);
      addNode(node);
    }
  }

  return {
    path: null,
    expanded,
    generated,
    reason: reachedTimeLimit ? "max-time" : "no-path",
  };

  function addNode(node: SearchNode): void {
    byF.push(node);
    notYetFocal.push(node);
    best.set(stateKey(node.cell, node.time), node);
    generated += 1;
  }

  function promoteEligible(threshold: number): void {
    while (true) {
      const candidate = peekNotPromoted(notYetFocal);
      if (!candidate || candidate.f > threshold) return;
      notYetFocal.pop();
      if (!candidate.active || candidate.inFocal) continue;
      candidate.inFocal = true;
      focal.push(candidate);
    }
  }

  function violatesVertex(cell: Cell, time: Time): boolean {
    return violatesConstraintsAtVertex(agent.id, cell, time, constraints, rules);
  }

  function violatesEdge(from: Cell, to: Cell, time: Time): boolean {
    return violatesConstraintsOnTransition(agent.id, from, to, time, constraints, rules);
  }

  function canStayAtGoal(from: Time): boolean {
    return canWaitAtGoalUnderConstraints(agent.id, agent.goal, from, constraints, rules);
  }

  function conflictsAtStart(cell: Cell): number {
    let count = 0;
    for (const path of otherPaths) {
      const other = positionAt(path, 0, rules);
      if (other && cellEquals(cell, other)) count += 1;
    }
    return count;
  }

  function transitionConflictCount(from: Cell, to: Cell, time: Time): number {
    let count = 0;
    for (const path of otherPaths) {
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
      if (
        rules.forbidFollowing &&
        previous &&
        current &&
        !cellEquals(from, to) &&
        !cellEquals(previous, current) &&
        cellEquals(to, previous)
      ) {
        count += 1;
      }
    }
    return count;
  }
}

function compareByF(a: SearchNode, b: SearchNode): number {
  return a.f - b.f || b.g - a.g || a.conflictCount - b.conflictCount || a.sequence - b.sequence;
}

function compareFocal(a: SearchNode, b: SearchNode): number {
  return a.conflictCount - b.conflictCount || a.f - b.f || b.g - a.g || a.sequence - b.sequence;
}

function peekActive(heap: MinHeap<SearchNode>): SearchNode | undefined {
  while (heap.peek() && !heap.peek()!.active) heap.pop();
  return heap.peek();
}

function peekNotPromoted(heap: MinHeap<SearchNode>): SearchNode | undefined {
  while (heap.peek() && (!heap.peek()!.active || heap.peek()!.inFocal)) heap.pop();
  return heap.peek();
}

function popActive(heap: MinHeap<SearchNode>): SearchNode | undefined {
  while (heap.size > 0) {
    const node = heap.pop()!;
    if (node.active) return node;
  }
  return undefined;
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
