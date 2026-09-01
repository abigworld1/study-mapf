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
import { MinHeap } from "./heap.js";
import {
  canWaitAtGoalUnderConstraints,
  violatesConstraintsAtVertex,
  violatesConstraintsOnTransition,
} from "./constraint-semantics.js";
import type { CbsLowLevelStopReason } from "./low-level.js";

export interface JointConstrainedSearchInput {
  readonly map: GridMap;
  readonly agents: readonly (AgentSpec & { readonly goal: Cell })[];
  readonly rules: SimulationRules;
  readonly constraints: readonly Constraint[];
  readonly maxTime: Time;
  readonly consumeExpansion: () => "ok" | CbsLowLevelStopReason;
  readonly onExpand?: (cells: readonly Cell[], time: Time, f: number) => void;
}

export interface JointConstrainedSearchOutput {
  readonly paths: readonly TimedPath[] | null;
  readonly cost?: number;
  readonly expanded: number;
  readonly generated: number;
  readonly reason?: "no-path" | "max-time" | CbsLowLevelStopReason;
}

interface JointNode {
  readonly cells: readonly Cell[];
  readonly time: Time;
  /** bit=1 は、その agent が goal へ最終到着済みで path cost の加算を終えた状態。 */
  readonly committedMask: number;
  readonly g: number;
  readonly h: number;
  readonly f: number;
  readonly sequence: number;
  readonly parent: JointNode | null;
}

/** 最大 3 体用の制約付き joint-state A*。g は group の正確な SOC。 */
export function constrainedJointAStar(
  input: JointConstrainedSearchInput,
): JointConstrainedSearchOutput {
  const { agents, constraints, map, maxTime, rules } = input;
  if (agents.length === 0 || agents.length > 3) {
    return { paths: null, expanded: 0, generated: 0, reason: "no-path" };
  }
  const allCommitted = (1 << agents.length) - 1;
  const distances = agents.map((agent) => trueDistanceFrom(map, agent.goal));
  const startCells = agents.map((agent) => agent.start);
  if (
    startCells.some((cell, index) =>
      violatesConstraintsAtVertex(agents[index]!.id, cell, 0, constraints, rules),
    ) ||
    hasVertexConflict(startCells)
  ) {
    return { paths: null, expanded: 0, generated: 0, reason: "no-path" };
  }

  const startH = heuristic(startCells, 0);
  if (!Number.isFinite(startH)) {
    return { paths: null, expanded: 0, generated: 0, reason: "no-path" };
  }
  const open = new MinHeap<JointNode>(compareJointNodes);
  const best = new Map<string, number>();
  let nextSequence = 1;
  let expanded = 0;
  let generated = 1;
  let reachedTimeLimit = false;
  const root: JointNode = {
    cells: startCells,
    time: 0,
    committedMask: 0,
    g: 0,
    h: startH,
    f: startH,
    sequence: 0,
    parent: null,
  };
  open.push(root);
  best.set(stateKey(root), 0);

  while (open.size > 0) {
    const current = open.pop()!;
    if (best.get(stateKey(current)) !== current.g) continue;
    const stop = input.consumeExpansion();
    if (stop !== "ok") return { paths: null, expanded, generated, reason: stop };
    expanded += 1;
    input.onExpand?.(current.cells, current.time, current.f);

    if (current.committedMask === allCommitted) {
      return {
        paths: reconstructPaths(agents, current),
        cost: current.g,
        expanded,
        generated,
      };
    }

    // goal で以後 wait できる agent を zero-time edge で commit する。
    // これにより、到着後に一度 goal を離れる経路も過小評価せず、g が最終的な
    // path length の総和と厳密に一致する。
    for (let index = 0; index < agents.length; index += 1) {
      const bit = 1 << index;
      if ((current.committedMask & bit) !== 0) continue;
      const agent = agents[index]!;
      if (
        cellEquals(current.cells[index]!, agent.goal) &&
        canWaitAtGoalUnderConstraints(agent.id, agent.goal, current.time, constraints, rules)
      ) {
        pushNode({
          cells: current.cells,
          time: current.time,
          committedMask: current.committedMask | bit,
          g: current.g,
          parent: current,
        });
      }
    }

    if (current.time >= maxTime) {
      reachedTimeLimit = true;
      continue;
    }
    const choices = current.cells.map((cell, index) =>
      (current.committedMask & (1 << index)) !== 0 ? [cell] : movesWithWait(map, cell, rules),
    );
    const next: Cell[] = new Array(agents.length);
    enumerate(0);

    function enumerate(index: number): void {
      if (index === agents.length) {
        const nextTime = current.time + 1;
        for (let agentIndex = 0; agentIndex < agents.length; agentIndex += 1) {
          const agent = agents[agentIndex]!;
          if (
            violatesConstraintsAtVertex(
              agent.id,
              next[agentIndex]!,
              nextTime,
              constraints,
              rules,
            ) ||
            violatesConstraintsOnTransition(
              agent.id,
              current.cells[agentIndex]!,
              next[agentIndex]!,
              nextTime,
              constraints,
              rules,
            )
          ) {
            return;
          }
        }
        if (hasJointTransitionConflict(current.cells, next, rules)) return;
        const activeCount = agents.length - bitCount(current.committedMask);
        pushNode({
          cells: next.slice(),
          time: nextTime,
          committedMask: current.committedMask,
          g: current.g + activeCount,
          parent: current,
        });
        return;
      }
      for (const cell of choices[index]!) {
        next[index] = cell;
        enumerate(index + 1);
      }
    }
  }

  return {
    paths: null,
    expanded,
    generated,
    reason: reachedTimeLimit ? "max-time" : "no-path",
  };

  function pushNode(inputNode: {
    readonly cells: readonly Cell[];
    readonly time: Time;
    readonly committedMask: number;
    readonly g: number;
    readonly parent: JointNode;
  }): void {
    const h = heuristic(inputNode.cells, inputNode.committedMask);
    if (!Number.isFinite(h)) return;
    const node: JointNode = {
      ...inputNode,
      h,
      f: inputNode.g + h,
      sequence: nextSequence,
    };
    nextSequence += 1;
    const key = stateKey(node);
    const previous = best.get(key);
    if (previous !== undefined && previous <= node.g) return;
    best.set(key, node.g);
    open.push(node);
    generated += 1;
  }

  function heuristic(cells: readonly Cell[], committedMask: number): number {
    let sum = 0;
    for (let index = 0; index < agents.length; index += 1) {
      if ((committedMask & (1 << index)) !== 0) continue;
      const value = lookupDistance(map, distances[index]!, cells[index]!);
      if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
      sum += value;
    }
    return sum;
  }
}

function stateKey(node: Pick<JointNode, "cells" | "time" | "committedMask">): string {
  return `${node.cells.map((cell) => `${cell.x},${cell.y}`).join("|")}@${node.time}#${node.committedMask}`;
}

function compareJointNodes(a: JointNode, b: JointNode): number {
  return a.f - b.f || a.h - b.h || a.time - b.time || a.sequence - b.sequence;
}

function hasVertexConflict(cells: readonly Cell[]): boolean {
  for (let first = 0; first < cells.length; first += 1) {
    for (let second = first + 1; second < cells.length; second += 1) {
      if (cellEquals(cells[first]!, cells[second]!)) return true;
    }
  }
  return false;
}

function hasJointTransitionConflict(
  previous: readonly Cell[],
  next: readonly Cell[],
  rules: SimulationRules,
): boolean {
  if (hasVertexConflict(next)) return true;
  for (let first = 0; first < next.length; first += 1) {
    for (let second = first + 1; second < next.length; second += 1) {
      if (
        rules.forbidEdgeSwap &&
        cellEquals(previous[first]!, next[second]!) &&
        cellEquals(previous[second]!, next[first]!)
      ) {
        return true;
      }
      if (
        rules.forbidFollowing &&
        ((cellEquals(next[first]!, previous[second]!) &&
          !cellEquals(previous[second]!, next[second]!)) ||
          (cellEquals(next[second]!, previous[first]!) &&
            !cellEquals(previous[first]!, next[first]!)))
      ) {
        return true;
      }
    }
  }
  return false;
}

function bitCount(value: number): number {
  let count = 0;
  for (let remaining = value; remaining > 0; remaining >>>= 1) count += remaining & 1;
  return count;
}

function reconstructPaths(
  agents: readonly (AgentSpec & { readonly goal: Cell })[],
  goal: JointNode,
): TimedPath[] {
  const chain: JointNode[] = [];
  for (let node: JointNode | null = goal; node; node = node.parent) chain.push(node);
  chain.reverse();
  const byTime = new Map<Time, readonly Cell[]>();
  const committedAt = new Array<number>(agents.length).fill(goal.time);
  for (const node of chain) {
    byTime.set(node.time, node.cells);
    for (let index = 0; index < agents.length; index += 1) {
      if ((node.committedMask & (1 << index)) !== 0 && committedAt[index] === goal.time) {
        committedAt[index] = node.time;
      }
    }
  }
  return agents.map((agent, index) => {
    const positions: TimedPosition[] = [];
    for (let time = 0; time <= committedAt[index]!; time += 1) {
      positions.push({ time, cell: byTime.get(time)![index]! });
    }
    return { agentId: agent.id, positions };
  });
}
