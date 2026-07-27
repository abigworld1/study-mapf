import type { AgentSpec, Cell, GridMap, SolverEvent, TimedPath } from "@/lib/model/types.js";
import { cellIndex, indexToCell, isWalkable, neighbors } from "@/lib/model/grid.js";

export type PushReason = "plan" | "clear" | "multipush" | "resolve";
export type EngineStop = "timeout" | "aborted" | "node-limit" | null;

export interface MoveRecord {
  readonly agent: number;
  readonly from: number;
  readonly to: number;
  readonly reason: PushReason;
}

export interface PushSnapshot {
  readonly positions: readonly number[];
  readonly occupancy: Int32Array;
  readonly framesLength: number;
  readonly recordsLength: number;
}

export interface PushEngineOptions {
  readonly map: GridMap;
  readonly agents: readonly (AgentSpec & { readonly goal: Cell })[];
  readonly maxMoves: number;
  readonly consumeExpansion: () => EngineStop;
  readonly emit: (event: SolverEvent) => void;
}

/**
 * Push 系 2 手法の primitive 実行器。
 * すべての move を「1 agent が隣接する空き vertex へ移る」として検査する。
 */
export class PushEngine {
  readonly positions: number[];
  readonly occupancy: Int32Array;
  readonly frames: number[][];
  readonly records: MoveRecord[] = [];
  stop: EngineStop = null;

  private readonly adjacency: readonly (readonly number[])[];
  private trialDepth = 0;

  constructor(private readonly options: PushEngineOptions) {
    const size = options.map.width * options.map.height;
    this.positions = options.agents.map((agent) => cellIndex(options.map, agent.start));
    this.occupancy = new Int32Array(size).fill(-1);
    for (let index = 0; index < this.positions.length; index += 1) {
      this.occupancy[this.positions[index]!] = index;
    }
    this.frames = [this.positions.slice()];
    this.adjacency = Array.from({ length: size }, (_, index) => {
      const cell = indexToCell(options.map, index);
      return isWalkable(options.map, cell)
        ? neighbors(options.map, cell)
            .map((next) => cellIndex(options.map, next))
            .sort((a, b) => a - b)
        : [];
    });
  }

  get moveCount(): number {
    return this.frames.length - 1;
  }

  degree(vertex: number): number {
    return this.adjacency[vertex]?.length ?? 0;
  }

  adjacent(vertex: number): readonly number[] {
    return this.adjacency[vertex] ?? [];
  }

  snapshotState(): PushSnapshot {
    return this.snapshot();
  }

  restoreState(snapshot: PushSnapshot): void {
    this.restore(snapshot);
  }

  recordsSince(recordOffset: number): readonly MoveRecord[] {
    return this.records.slice(recordOffset);
  }

  /** 失敗した primitive の全 move を巻き戻し、成功時だけ event として公開する。 */
  attempt(operation: () => boolean): boolean {
    const snapshot = this.snapshot();
    this.trialDepth += 1;
    const ok = operation();
    this.trialDepth -= 1;
    if (!ok) {
      this.restore(snapshot);
      return false;
    }
    if (this.trialDepth === 0) {
      for (const record of this.records.slice(snapshot.recordsLength)) this.emitMove(record);
    }
    return true;
  }

  reverseRecords(records: readonly MoveRecord[], first: number, second: number): boolean {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index]!;
      const agent =
        record.agent === first ? second : record.agent === second ? first : record.agent;
      if (!this.move(agent, record.from, "resolve")) return false;
    }
    return true;
  }

  move(agent: number, to: number, reason: PushReason): boolean {
    if (this.stop) return false;
    const state = this.options.consumeExpansion();
    if (state) {
      this.stop = state;
      return false;
    }
    if (this.moveCount >= this.options.maxMoves) {
      this.stop = "node-limit";
      return false;
    }
    const from = this.positions[agent];
    if (from === undefined || !this.adjacent(from).includes(to) || this.occupancy[to] !== -1) {
      return false;
    }
    this.occupancy[from] = -1;
    this.occupancy[to] = agent;
    this.positions[agent] = to;
    this.records.push({ agent, from, to, reason });
    this.frames.push(this.positions.slice());
    if (this.trialDepth === 0) this.emitMove(this.records[this.records.length - 1]!);
    return true;
  }

  /** BFS。occupied vertex は障害とせず、forbidden だけを除外する。 */
  shortestPath(
    start: number,
    goal: number,
    forbidden: ReadonlySet<number> = new Set(),
  ): number[] | null {
    if (start === goal) return [start];
    const size = this.occupancy.length;
    const parent = new Int32Array(size).fill(-2);
    const queue = new Int32Array(size);
    let head = 0;
    let tail = 0;
    parent[start] = -1;
    queue[tail++] = start;
    while (head < tail) {
      const state = this.options.consumeExpansion();
      if (state) {
        this.stop = state;
        return null;
      }
      const current = queue[head++]!;
      for (const next of this.adjacent(current)) {
        if (parent[next] !== -2 || (forbidden.has(next) && next !== goal)) continue;
        parent[next] = current;
        if (next === goal) return reconstruct(parent, goal);
        queue[tail++] = next;
      }
    }
    return null;
  }

  /** target の占有 agent を、最寄りの空き vertex へ連鎖的に押し出す。 */
  clearVertex(
    target: number,
    forbidden: ReadonlySet<number>,
    reason: PushReason = "clear",
  ): boolean {
    if (this.occupancy[target] === -1) return true;
    if (forbidden.has(target)) return false;
    const path = this.pathToNearestEmpty(target, forbidden);
    if (!path || path.length < 2) return false;
    for (let offset = path.length - 2; offset >= 0; offset -= 1) {
      const from = path[offset]!;
      const agent = this.occupancy[from]!;
      if (agent < 0 || !this.move(agent, path[offset + 1]!, reason)) return false;
    }
    if (this.trialDepth === 0) {
      this.options.emit({
        type: "clear-vertex",
        cell: indexToCell(this.options.map, target),
        emptyCell: indexToCell(this.options.map, path[path.length - 1]!),
      });
    }
    return true;
  }

  /** planning agent と直前の blocker を P&S の multipush/clear/exchange/reverse で交換する。 */
  swapAgents(planning: number, blocker: number): boolean {
    const planningPosition = this.positions[planning]!;
    const blockerPosition = this.positions[blocker]!;
    if (!this.adjacent(planningPosition).includes(blockerPosition)) return false;

    const candidates = Array.from({ length: this.occupancy.length }, (_, index) => index)
      .filter((vertex) => this.degree(vertex) >= 3)
      .flatMap((vertex) => {
        const planningPath =
          planningPosition === vertex
            ? [vertex]
            : blockerPosition === vertex
              ? null
              : this.shortestPath(planningPosition, vertex, new Set([blockerPosition]));
        const blockerPath =
          blockerPosition === vertex
            ? [vertex]
            : planningPosition === vertex
              ? null
              : this.shortestPath(blockerPosition, vertex, new Set([planningPosition]));
        const choices = [
          planningPath ? { lead: planning, trailer: blocker, path: planningPath } : undefined,
          blockerPath ? { lead: blocker, trailer: planning, path: blockerPath } : undefined,
        ].filter(
          (choice): choice is { lead: number; trailer: number; path: number[] } =>
            choice !== undefined,
        );
        choices.sort(
          (left, right) => left.path.length - right.path.length || left.lead - right.lead,
        );
        const selected = choices[0];
        return selected ? [{ vertex, ...selected }] : [];
      })
      .sort((left, right) => left.path.length - right.path.length || left.vertex - right.vertex);
    if (this.stop) return false;

    for (const candidate of candidates) {
      const snapshot = this.snapshot();
      this.trialDepth += 1;
      const ok =
        this.preparePair(candidate.trailer, candidate.lead, candidate.path) &&
        this.exchangeAndReverse(planning, blocker, snapshot.recordsLength);
      this.trialDepth -= 1;
      if (!ok) {
        this.restore(snapshot);
        if (this.stop) return false;
        continue;
      }
      const committed = this.records.slice(snapshot.recordsLength);
      if (this.trialDepth === 0) {
        this.options.emit({
          type: "swap-agents",
          agentA: this.options.agents[planning]!.id,
          agentB: this.options.agents[blocker]!.id,
          phase: "start",
        });
        for (const record of committed) this.emitMove(record);
        this.options.emit({
          type: "swap-agents",
          agentA: this.options.agents[planning]!.id,
          agentB: this.options.agents[blocker]!.id,
          phase: "finish",
        });
      }
      return true;
    }
    return false;
  }

  /** Algorithm 4.2.10: 空き cycle と満杯 cycle の両方を 1 回転する。 */
  rotateCycle(cycle: readonly number[]): boolean {
    const moved: number[] = [];
    if (cycle.length < 3) return false;
    const ok = this.attempt(() => {
      const emptyOffset = cycle.findIndex((vertex) => this.occupancy[vertex] === -1);
      if (emptyOffset >= 0) return this.rotateIntoEmpty(cycle, emptyOffset, moved);

      for (let offset = 0; offset < cycle.length; offset += 1) {
        const candidateSnapshot = this.snapshot();
        const vertex = cycle[offset]!;
        const first = this.occupancy[vertex]!;
        const recordOffset = this.records.length;
        const blocked = new Set(cycle.filter((item) => item !== vertex));
        if (first >= 0 && this.clearVertex(vertex, blocked, "clear")) {
          const preparation = this.records.slice(recordOffset);
          const previousOffset = (offset - 1 + cycle.length) % cycle.length;
          const previous = cycle[previousOffset]!;
          const second = this.occupancy[previous]!;
          if (
            second >= 0 &&
            this.move(second, vertex, "resolve") &&
            this.swapAgents(first, second) &&
            this.rotateIntoEmpty(cycle, previousOffset, moved) &&
            this.reverseRecords(preparation, first, second)
          ) {
            return true;
          }
        }
        this.restore(candidateSnapshot);
        if (this.stop) return false;
      }
      return false;
    });
    if (!ok) return false;
    this.options.emit({
      type: "rotate-cycle",
      agentIds: moved.map((index) => this.options.agents[index]!.id),
      cells: cycle.map((vertex) => indexToCell(this.options.map, vertex)),
    });
    return true;
  }

  toPaths(): TimedPath[] {
    return this.options.agents.map((agent, index) => ({
      agentId: agent.id,
      positions: this.frames.map((frame, time) => ({
        cell: indexToCell(this.options.map, frame[index]!),
        time,
      })),
    }));
  }

  private preparePair(planning: number, blocker: number, blockerPath: readonly number[]): boolean {
    for (let offset = 1; offset < blockerPath.length; offset += 1) {
      const next = blockerPath[offset]!;
      const planningPosition = this.positions[planning]!;
      const blockerPosition = this.positions[blocker]!;
      if (!this.clearVertex(next, new Set([planningPosition, blockerPosition]), "clear"))
        return false;
      if (!this.move(blocker, next, "multipush")) return false;
      if (!this.move(planning, blockerPosition, "multipush")) return false;
    }
    return true;
  }

  private rotateIntoEmpty(cycle: readonly number[], emptyOffset: number, moved: number[]): boolean {
    let empty = cycle[emptyOffset]!;
    for (let step = 1; step < cycle.length; step += 1) {
      const sourceOffset = (emptyOffset - step + cycle.length) % cycle.length;
      const source = cycle[sourceOffset]!;
      const agent = this.occupancy[source]!;
      if (agent < 0 || !this.move(agent, empty, "resolve")) return false;
      moved.push(agent);
      empty = source;
    }
    return true;
  }

  private exchangeAndReverse(planning: number, blocker: number, preparationStart: number): boolean {
    const center =
      this.degree(this.positions[blocker]!) >= 3
        ? this.positions[blocker]!
        : this.positions[planning]!;
    const initialOuterAgent = this.occupancy[center] === planning ? blocker : planning;
    const initialOuter = this.positions[initialOuterAgent]!;
    if (!this.adjacent(center).includes(initialOuter) || this.degree(center) < 3) return false;
    if (!this.clearSwapNeighborhood(planning, blocker, center)) return false;

    const centerAgent = this.occupancy[center]!;
    const outerAgent = centerAgent === planning ? blocker : planning;
    const outer = this.positions[outerAgent]!;
    const empties = this.adjacent(center).filter((vertex) => this.occupancy[vertex] === -1);
    if (centerAgent < 0 || !this.adjacent(center).includes(outer) || empties.length < 2)
      return false;
    const [first, second] = empties as [number, number, ...number[]];
    const preparation = this.records.slice(preparationStart);

    if (!this.move(centerAgent, first, "clear")) return false;
    if (!this.move(outerAgent, center, "clear")) return false;
    if (!this.move(outerAgent, second, "clear")) return false;
    if (!this.move(centerAgent, center, "clear")) return false;
    if (!this.move(centerAgent, outer, "clear")) return false;
    if (!this.move(outerAgent, center, "clear")) return false;

    return this.reverseRecords(preparation, planning, blocker);
  }

  /** Thesis Algorithm 4.2.8 の 4-stage clear。 */
  private clearSwapNeighborhood(firstAgent: number, secondAgent: number, center: number): boolean {
    let centerAgent = this.occupancy[center]!;
    let outerAgent = centerAgent === firstAgent ? secondAgent : firstAgent;
    let outer = this.positions[outerAgent]!;
    if (centerAgent < 0 || !this.adjacent(center).includes(outer)) return false;

    // Stage 1: center と pair の外側を固定して、各 neighbor を直接 clear。
    const empties: number[] = this.adjacent(center).filter(
      (vertex) => vertex !== outer && this.occupancy[vertex] === -1,
    );
    for (const candidate of this.adjacent(center)) {
      if (candidate === outer || empties.includes(candidate)) continue;
      if (this.clearVertex(candidate, new Set([center, outer, ...empties]), "clear")) {
        empties.push(candidate);
        if (empties.length >= 2) return true;
      }
      if (this.stop) return false;
    }
    if (empties.length === 0) return false;
    const epsilon = empties[0]!;

    // Stage 2: n→epsilon の迂回を使い、epsilon をもう一度空ける。
    for (const candidate of this.adjacent(center)) {
      if (candidate === outer || candidate === epsilon) continue;
      const snapshot = this.snapshot();
      if (
        this.clearVertex(candidate, new Set([center, outer]), "clear") &&
        this.clearVertex(epsilon, new Set([center, outer, candidate]), "clear")
      ) {
        return true;
      }
      this.restore(snapshot);
      if (this.stop) return false;
    }

    // Stage 3: pair を一時的にずらし、外側 vertex を 2 個目の空きにする。
    for (const candidate of this.adjacent(center)) {
      if (candidate === outer || candidate === epsilon) continue;
      const snapshot = this.snapshot();
      if (
        this.move(centerAgent, epsilon, "clear") &&
        this.move(outerAgent, center, "clear") &&
        this.clearVertex(candidate, new Set([center, epsilon]), "clear") &&
        this.clearVertex(outer, new Set([center, epsilon, candidate]), "clear")
      ) {
        return true;
      }
      this.restore(snapshot);
      if (this.stop) return false;
    }

    // Stage 4: epsilon の背後へ 1 体押し込み、n と epsilon を空け直す。
    centerAgent = this.occupancy[center]!;
    outerAgent = centerAgent === firstAgent ? secondAgent : firstAgent;
    outer = this.positions[outerAgent]!;
    if (!this.clearVertex(outer, new Set([center]), "clear")) return false;
    if (!this.move(centerAgent, outer, "clear")) return false;
    const outerAgentPosition = this.positions[outerAgent]!;
    if (!this.clearVertex(epsilon, new Set([center, outer, outerAgentPosition]), "clear")) {
      return false;
    }
    const candidate = this.adjacent(center).find(
      (vertex) => vertex !== outer && vertex !== epsilon && this.occupancy[vertex]! >= 0,
    );
    if (candidate === undefined) return false;
    const moving = this.occupancy[candidate]!;
    if (!this.move(moving, center, "clear") || !this.move(moving, epsilon, "clear")) return false;
    if (!this.move(centerAgent, center, "clear")) return false;
    if (!this.move(outerAgent, outer, "clear")) return false;
    return this.clearVertex(epsilon, new Set([center, outer, candidate]), "clear");
  }

  private pathToNearestEmpty(start: number, forbidden: ReadonlySet<number>): number[] | null {
    const parent = new Int32Array(this.occupancy.length).fill(-2);
    const queue = new Int32Array(this.occupancy.length);
    let head = 0;
    let tail = 0;
    parent[start] = -1;
    queue[tail++] = start;
    while (head < tail) {
      const state = this.options.consumeExpansion();
      if (state) {
        this.stop = state;
        return null;
      }
      const current = queue[head++]!;
      if (current !== start && this.occupancy[current] === -1) return reconstruct(parent, current);
      for (const next of this.adjacent(current)) {
        if (parent[next] !== -2 || forbidden.has(next)) continue;
        parent[next] = current;
        queue[tail++] = next;
      }
    }
    return null;
  }

  private snapshot(): PushSnapshot {
    return {
      positions: this.positions.slice(),
      occupancy: this.occupancy.slice(),
      framesLength: this.frames.length,
      recordsLength: this.records.length,
    };
  }

  private restore(snapshot: PushSnapshot): void {
    this.positions.splice(0, this.positions.length, ...snapshot.positions);
    this.occupancy.set(snapshot.occupancy);
    this.frames.length = snapshot.framesLength;
    this.records.length = snapshot.recordsLength;
  }

  private emitMove(record: MoveRecord): void {
    const positions: Record<string, Cell> = {};
    const frame =
      this.frames[this.frames.length - (this.records.length - this.records.indexOf(record))];
    const resolved = frame ?? this.positions;
    for (let index = 0; index < this.options.agents.length; index += 1) {
      positions[this.options.agents[index]!.id] = indexToCell(this.options.map, resolved[index]!);
    }
    this.options.emit({
      type: "push-agent",
      agentId: this.options.agents[record.agent]!.id,
      from: indexToCell(this.options.map, record.from),
      to: indexToCell(this.options.map, record.to),
      reason: record.reason,
    });
    this.options.emit({ type: "move", time: this.records.indexOf(record) + 1, positions });
  }
}

function reconstruct(parent: Int32Array, goal: number): number[] {
  const path: number[] = [];
  let current = goal;
  while (current >= 0) {
    path.push(current);
    current = parent[current] ?? -1;
  }
  path.reverse();
  return path;
}
