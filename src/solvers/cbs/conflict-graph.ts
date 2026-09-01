export interface ConflictGraphEdge {
  readonly agentA: string;
  readonly agentB: string;
}

export interface ConflictGraphLowerBound {
  readonly value: number;
  readonly method: "exact-minimum-vertex-cover" | "maximal-matching";
  readonly vertexCount: number;
  readonly edgeCount: number;
}

/**
 * Cardinal-conflict graph の vertex-cover 下界を返す。
 *
 * 小さい graph では分岐により minimum vertex cover を厳密に求める。大きい
 * graph では maximal matching の大きさへ下げる。matching の各辺を解消するには
 * 相異なる端点が少なくとも 1 つずつ必要なので、こちらも vertex cover size の
 * 下界であり、近似 vertex cover の大きさを h として使うより弱いが許容である。
 */
export function cardinalConflictGraphLowerBound(
  inputEdges: readonly ConflictGraphEdge[],
  exactVertexLimit = 18,
): ConflictGraphLowerBound {
  const edges = normalizeEdges(inputEdges);
  const vertices = [...new Set(edges.flatMap((edge) => [edge.agentA, edge.agentB]))].sort();
  if (vertices.length <= exactVertexLimit) {
    return {
      value: exactMinimumVertexCover(edges),
      method: "exact-minimum-vertex-cover",
      vertexCount: vertices.length,
      edgeCount: edges.length,
    };
  }
  return {
    value: maximalMatchingLowerBound(edges),
    method: "maximal-matching",
    vertexCount: vertices.length,
    edgeCount: edges.length,
  };
}

function exactMinimumVertexCover(edges: readonly ConflictGraphEdge[]): number {
  if (edges.length === 0) return 0;
  let best = Number.POSITIVE_INFINITY;

  function search(remaining: readonly ConflictGraphEdge[], chosen: number): void {
    if (chosen >= best) return;
    const edge = remaining[0];
    if (!edge) {
      best = chosen;
      return;
    }
    search(
      remaining.filter(
        (candidate) => candidate.agentA !== edge.agentA && candidate.agentB !== edge.agentA,
      ),
      chosen + 1,
    );
    search(
      remaining.filter(
        (candidate) => candidate.agentA !== edge.agentB && candidate.agentB !== edge.agentB,
      ),
      chosen + 1,
    );
  }

  search(edges, 0);
  return Number.isFinite(best) ? best : 0;
}

function maximalMatchingLowerBound(edges: readonly ConflictGraphEdge[]): number {
  const matched = new Set<string>();
  let size = 0;
  for (const edge of edges) {
    if (matched.has(edge.agentA) || matched.has(edge.agentB)) continue;
    matched.add(edge.agentA);
    matched.add(edge.agentB);
    size += 1;
  }
  return size;
}

function normalizeEdges(edges: readonly ConflictGraphEdge[]): ConflictGraphEdge[] {
  const byKey = new Map<string, ConflictGraphEdge>();
  for (const edge of edges) {
    if (edge.agentA === edge.agentB) continue;
    const [agentA, agentB] =
      edge.agentA < edge.agentB ? [edge.agentA, edge.agentB] : [edge.agentB, edge.agentA];
    byKey.set(`${agentA}\u0000${agentB}`, { agentA, agentB });
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.agentA.localeCompare(right.agentA) || left.agentB.localeCompare(right.agentB),
  );
}
