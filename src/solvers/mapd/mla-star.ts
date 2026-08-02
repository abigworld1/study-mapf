import type { AgentId, Cell, Scenario, SolverEvent, TimedPath } from "@/lib/model/types.js";
import {
  cellEquals,
  cellKey,
  isAdjacentOrSame,
  neighbors,
  trueDistanceFrom,
} from "@/lib/model/grid.js";
import { positionAt } from "@/lib/model/conflicts.js";

export interface MlaStarInput {
  readonly scenario: Scenario;
  readonly agentId: AgentId;
  readonly start: Cell;
  readonly startTime: number;
  readonly pickup: Cell;
  readonly delivery: Cell;
  readonly token: ReadonlyMap<AgentId, TimedPath>;
  readonly maxTime: number;
  readonly maxExpansions: number;
  readonly pickupLatestTime?: number;
  readonly shouldStop?: () => boolean;
  readonly emit?: (event: SolverEvent) => void;
}

export interface MlaStarOutput {
  readonly path: TimedPath | null;
  readonly expanded: number;
  readonly exhausted: boolean;
}

interface Node {
  readonly key: string;
  readonly cell: Cell;
  readonly time: number;
  readonly label: 0 | 1;
  readonly g: number;
  readonly h: number;
  readonly order: number;
}

interface QueueEntry {
  readonly node: Node;
  readonly f: number;
}

/**
 * Multi-Label A* の低レベル探索。
 *
 * 原論文 Algorithm 1 の label（pickup 前 / pickup 後）を明示的に持つ。
 * token の経路は予約表へ潰さず、時刻ごとの vertex / edge を直接照合する。
 */
export function mlaStar(input: MlaStarInput): MlaStarOutput {
  const pickupDistance = trueDistanceFrom(input.scenario.map, input.pickup);
  const deliveryDistance = trueDistanceFrom(input.scenario.map, input.delivery);
  const queue = new MinHeap();
  const nodes = new Map<string, Node>();
  const parent = new Map<string, string | undefined>();
  const closed = new Set<string>();
  let order = 0;
  let expanded = 0;

  const initial: Node = {
    key: stateKey(input.start, input.startTime, 0),
    cell: input.start,
    time: input.startTime,
    label: 0,
    g: 0,
    h: heuristic(input, input.start, 0, pickupDistance, deliveryDistance),
    order: order++,
  };
  nodes.set(initial.key, initial);
  parent.set(initial.key, undefined);
  queue.push({ node: initial, f: initial.g + initial.h });

  while (!queue.empty) {
    if (input.shouldStop?.()) return { path: null, expanded, exhausted: true };
    const entry = queue.pop()!;
    const node = entry.node;
    if (closed.has(node.key)) continue;
    closed.add(node.key);

    if (
      node.label === 1 &&
      cellEquals(node.cell, input.delivery) &&
      goalRemainsConflictFree(input, node.cell, node.time)
    ) {
      return {
        path: reconstruct(node.key, nodes, parent, input.agentId),
        expanded,
        exhausted: false,
      };
    }
    if (
      node.label === 0 &&
      input.pickupLatestTime !== undefined &&
      node.time > input.pickupLatestTime
    )
      continue;

    expanded += 1;
    input.emit?.({
      type: "expand-node",
      agentId: input.agentId,
      state: { algorithm: "mla-star", label: node.label, time: node.time, cell: node.cell },
    });
    if (expanded >= input.maxExpansions) return { path: null, expanded, exhausted: true };

    // Arriving at pickup changes the label without consuming a timestep.
    if (node.label === 0 && cellEquals(node.cell, input.pickup)) {
      const nextKey = stateKey(node.cell, node.time, 1);
      if (!closed.has(nextKey)) {
        const next: Node = {
          key: nextKey,
          cell: node.cell,
          time: node.time,
          label: 1,
          g: node.g,
          h: heuristic(input, node.cell, 1, pickupDistance, deliveryDistance),
          order: order++,
        };
        nodes.set(nextKey, next);
        parent.set(nextKey, node.key);
        queue.push({ node: next, f: next.g + next.h });
      }
    }

    if (node.time >= input.maxTime) continue;
    for (const nextCell of [
      node.cell,
      ...neighbors(input.scenario.map, node.cell, input.scenario.rules),
    ]) {
      const nextTime = node.time + 1;
      if (
        !isAdjacentOrSame(node.cell, nextCell, input.scenario.rules.allowDiagonal) ||
        (node.label === 0 &&
          input.pickupLatestTime !== undefined &&
          nextTime > input.pickupLatestTime)
      )
        continue;
      if (tokenConflict(input, node.cell, nextCell, nextTime)) continue;
      const nextKey = stateKey(nextCell, nextTime, node.label);
      if (closed.has(nextKey)) continue;
      const next: Node = {
        key: nextKey,
        cell: nextCell,
        time: nextTime,
        label: node.label,
        g: node.g + 1,
        h: heuristic(input, nextCell, node.label, pickupDistance, deliveryDistance),
        order: order++,
      };
      const previous = nodes.get(nextKey);
      if (previous && previous.g + previous.h <= next.g + next.h) continue;
      nodes.set(nextKey, next);
      parent.set(nextKey, node.key);
      queue.push({ node: next, f: next.g + next.h });
    }
  }
  return { path: null, expanded, exhausted: false };
}

/**
 * A MAPD path does not disappear when it reaches delivery: under the site's
 * default `goalBehavior: "stay"` it reserves that cell for all later times.
 * Check that resting tail before accepting a goal.  Without this check a
 * later token path could be planned through an earlier agent's delivery
 * endpoint even though the earlier agent remains there forever.
 */
function goalRemainsConflictFree(input: MlaStarInput, goal: Cell, arrival: number): boolean {
  for (let time = arrival; time <= input.maxTime; time += 1) {
    if (tokenConflict(input, goal, goal, time)) return false;
  }
  return true;
}

function stateKey(cell: Cell, time: number, label: 0 | 1): string {
  return `${cellKey(cell)}@${time}@${label}`;
}

function heuristic(
  input: MlaStarInput,
  cell: Cell,
  label: 0 | 1,
  pickupDistance: Float64Array,
  deliveryDistance: Float64Array,
): number {
  const index = cell.y * input.scenario.map.width + cell.x;
  const toPickup = pickupDistance[index] ?? Number.POSITIVE_INFINITY;
  const pickupIndex = input.pickup.y * input.scenario.map.width + input.pickup.x;
  const pickupToDelivery = deliveryDistance[pickupIndex] ?? Number.POSITIVE_INFINITY;
  const toDelivery = deliveryDistance[index] ?? Number.POSITIVE_INFINITY;
  const distance = label === 0 ? toPickup + pickupToDelivery : toDelivery;
  return Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY;
}

function tokenConflict(input: MlaStarInput, from: Cell, to: Cell, time: number): boolean {
  for (const [otherId, path] of input.token) {
    if (otherId === input.agentId) continue;
    const otherNow = positionAt(path, time, input.scenario.rules);
    if (otherNow && cellEquals(to, otherNow)) return true;
    if (input.scenario.rules.forbidEdgeSwap) {
      const otherPrevious = positionAt(path, time - 1, input.scenario.rules);
      if (
        otherPrevious &&
        otherNow &&
        cellEquals(from, otherNow) &&
        cellEquals(to, otherPrevious) &&
        !cellEquals(from, to)
      )
        return true;
    }
    if (input.scenario.rules.forbidFollowing) {
      const otherPrevious = positionAt(path, time - 1, input.scenario.rules);
      if (
        otherPrevious &&
        otherNow &&
        cellEquals(to, otherPrevious) &&
        !cellEquals(otherPrevious, otherNow)
      )
        return true;
    }
  }
  return false;
}

function reconstruct(
  key: string,
  nodes: ReadonlyMap<string, Node>,
  parent: ReadonlyMap<string, string | undefined>,
  agentId: AgentId,
): TimedPath {
  const chain: Node[] = [];
  let current: string | undefined = key;
  while (current !== undefined) {
    const node = nodes.get(current);
    if (!node) break;
    chain.push(node);
    current = parent.get(current);
  }
  chain.reverse();
  const positions: { time: number; cell: Cell }[] = [];
  for (const node of chain) {
    if (positions[positions.length - 1]?.time === node.time) continue;
    positions.push({ time: node.time, cell: node.cell });
  }
  return { agentId, positions };
}

class MinHeap {
  private readonly entries: QueueEntry[] = [];

  get empty(): boolean {
    return this.entries.length === 0;
  }

  push(entry: QueueEntry): void {
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compare(this.entries[parent]!, entry) <= 0) break;
      this.entries[index] = this.entries[parent]!;
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): QueueEntry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!first || !last || this.entries.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.entries.length) break;
      const right = left + 1;
      const child =
        right < this.entries.length && compare(this.entries[right]!, this.entries[left]!) < 0
          ? right
          : left;
      if (compare(this.entries[child]!, last) >= 0) break;
      this.entries[index] = this.entries[child]!;
      index = child;
    }
    this.entries[index] = last;
    return first;
  }
}

function compare(a: QueueEntry, b: QueueEntry): number {
  return a.f - b.f || a.node.h - b.node.h || a.node.order - b.node.order;
}
