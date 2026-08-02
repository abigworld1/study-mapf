/**
 * Deterministic successive-shortest-augmenting-path min-cost max-flow.
 *
 * The graph is intentionally small and dependency-free because it runs in a
 * Web Worker.  Bellman--Ford is used for residual shortest paths, so reverse
 * edges with negative cost are handled without a separate potential pass.
 */

export interface FlowEdge {
  readonly from: number;
  readonly to: number;
  readonly capacity: number;
  readonly cost: number;
  readonly flow: number;
}

interface ResidualEdge {
  readonly from: number;
  readonly to: number;
  capacity: number;
  readonly cost: number;
  readonly reverse: ResidualEdge | null;
  readonly initialCapacity: number;
  flow: number;
  readonly tag?: string;
}

export interface MinCostMaxFlowResult {
  readonly flow: number;
  readonly cost: number;
  readonly edges: readonly FlowEdge[];
  readonly augmentations: number;
}

export class MinCostMaxFlow {
  private readonly graph: ResidualEdge[][];
  private readonly forwardEdges: ResidualEdge[] = [];

  constructor(nodeCount: number) {
    this.graph = Array.from({ length: nodeCount }, () => []);
  }

  addEdge(from: number, to: number, capacity: number, cost: number, tag?: string): void {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0) {
      throw new RangeError("flow node is out of range");
    }
    if (capacity < 0 || !Number.isFinite(cost)) throw new RangeError("invalid flow edge");
    const forward = {
      from,
      to,
      capacity,
      cost,
      reverse: null as ResidualEdge | null,
      initialCapacity: capacity,
      flow: 0,
      ...(tag ? { tag } : {}),
    } as ResidualEdge;
    const reverse = {
      from: to,
      to: from,
      capacity: 0,
      cost: -cost,
      reverse: forward,
      initialCapacity: 0,
      flow: 0,
    } as ResidualEdge;
    (forward as { reverse: ResidualEdge }).reverse = reverse;
    this.graph[from]?.push(forward);
    this.graph[to]?.push(reverse);
    this.forwardEdges.push(forward);
  }

  solve(
    source: number,
    sink: number,
    requestedFlow = Number.POSITIVE_INFINITY,
  ): MinCostMaxFlowResult {
    let flow = 0;
    let cost = 0;
    let augmentations = 0;
    while (flow < requestedFlow) {
      const previous: (ResidualEdge | null)[] = Array.from(
        { length: this.graph.length },
        () => null,
      );
      const distance = new Array<number>(this.graph.length).fill(Number.POSITIVE_INFINITY);
      distance[source] = 0;
      for (let pass = 0; pass < this.graph.length - 1; pass += 1) {
        let changed = false;
        for (let node = 0; node < this.graph.length; node += 1) {
          if (!Number.isFinite(distance[node])) continue;
          for (const edge of this.graph[node] ?? []) {
            if (edge.capacity <= 0) continue;
            const candidate = distance[node]! + edge.cost;
            if (
              candidate < distance[edge.to]! - 1e-9 ||
              (Math.abs(candidate - distance[edge.to]!) <= 1e-9 &&
                (previous[edge.to] === null || edge.from < previous[edge.to]!.from))
            ) {
              distance[edge.to] = candidate;
              previous[edge.to] = edge;
              changed = true;
            }
          }
        }
        if (!changed) break;
      }
      if (!Number.isFinite(distance[sink])) break;
      let augment = requestedFlow - flow;
      for (let node = sink; node !== source;) {
        const edge = previous[node];
        if (!edge) {
          augment = 0;
          break;
        }
        augment = Math.min(augment, edge.capacity);
        node = edge.from;
      }
      if (augment <= 0) break;
      for (let node = sink; node !== source;) {
        const edge = previous[node]!;
        edge.capacity -= augment;
        edge.reverse!.capacity += augment;
        edge.flow += augment;
        edge.reverse!.flow -= augment;
        node = edge.from;
      }
      flow += augment;
      cost += augment * distance[sink]!;
      augmentations += 1;
    }

    return {
      flow,
      cost,
      augmentations,
      edges: this.forwardEdges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        capacity: edge.initialCapacity,
        cost: edge.cost,
        flow: edge.flow,
      })),
    };
  }

  /** Used by the time-expanded CBM adapter to inspect tagged flow edges. */
  usedTaggedEdges(): readonly { tag: string; from: number; to: number; flow: number }[] {
    return this.forwardEdges
      .filter((edge) => edge.tag && edge.flow > 0)
      .map((edge) => ({ tag: edge.tag!, from: edge.from, to: edge.to, flow: edge.flow }));
  }
}
