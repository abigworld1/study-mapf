import type { AgentSpec, Cell, GridMap } from "@/lib/model/types.js";
import { cellIndex, indexToCell, isWalkable, neighbors } from "@/lib/model/grid.js";

export interface PushSubproblem {
  readonly id: string;
  readonly cells: readonly number[];
  readonly agentIndices: readonly number[];
}

export interface DecompositionResult {
  readonly subproblems: readonly PushSubproblem[];
  readonly order: readonly number[];
  readonly priorityEdges: readonly { higher: number; lower: number }[];
  readonly stopped: boolean;
  /**
   * 優先度関係に閉路があり、順序を決めるために 1 本切ったか。
   *
   * ★ 閉路があること自体は「解なし」ではない（原論文 Algorithm 4 は
   *   全順序を要求しない）。ただし論文どおりの優先順位から外れるので、
   *   失敗したときに「手法の前提から外れた可能性がある」と言えるよう
   *   呼び出し側へ伝える。
   */
  readonly brokeCycle: boolean;
}

interface MutableSubproblem {
  readonly cells: Set<number>;
  readonly agents: Set<number>;
}

interface GraphData {
  readonly adjacency: readonly (readonly number[])[];
  readonly walkable: readonly number[];
  readonly componentLabels: Int32Array;
  readonly componentCells: readonly (readonly number[])[];
}

/** Push and Rotate thesis Algorithms 4.1.1–4.1.4 の決定的な grid 実装。 */
export function decomposeAndOrder(
  map: GridMap,
  agents: readonly (AgentSpec & { readonly goal: Cell })[],
  random: () => number,
  consume: () => boolean,
): DecompositionResult {
  const graph = buildGraph(map);
  const starts = new Int32Array(map.width * map.height).fill(-1);
  const goals = new Int32Array(map.width * map.height).fill(-1);
  for (let index = 0; index < agents.length; index += 1) {
    starts[cellIndex(map, agents[index]!.start)] = index;
    goals[cellIndex(map, agents[index]!.goal)] = index;
  }

  const rawComponents = biconnectedComponents(graph, consume);
  if (!rawComponents) return emptyStopped();
  const subproblems: MutableSubproblem[] = rawComponents
    .filter((component) => component.size >= 3)
    .map((component) => ({ cells: component, agents: new Set<number>() }));
  for (const vertex of graph.walkable) {
    if (graph.adjacency[vertex]!.length < 3) continue;
    if (
      !subproblems.some((subproblem) => subproblem.cells.size === 1 && subproblem.cells.has(vertex))
    ) {
      subproblems.push({ cells: new Set([vertex]), agents: new Set<number>() });
    }
  }

  // Algorithm 4.1.1 lines 3–7: m−2 以下の距離にある component を再帰的に merge。
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let left = 0; left < subproblems.length; left += 1) {
      for (let right = left + 1; right < subproblems.length; right += 1) {
        const a = subproblems[left]!;
        const b = subproblems[right]!;
        const aVertex = a.cells.values().next().value as number | undefined;
        const bVertex = b.cells.values().next().value as number | undefined;
        if (aVertex === undefined || bVertex === undefined) continue;
        const component = graph.componentLabels[aVertex]!;
        if (component !== graph.componentLabels[bVertex]) continue;
        const componentCells = graph.componentCells[component] ?? [];
        const componentAgents = agents.filter(
          (agent) => graph.componentLabels[cellIndex(map, agent.start)] === component,
        ).length;
        const emptyCount = componentCells.length - componentAgents;
        const connection = shortestBetweenSets(graph, a.cells, b.cells, consume);
        if (connection === "stopped") return emptyStopped();
        if (!connection || connection.length - 1 > emptyCount - 2) continue;
        for (const vertex of b.cells) a.cells.add(vertex);
        for (const vertex of connection) a.cells.add(vertex);
        subproblems.splice(right, 1);
        merged = true;
        break outer;
      }
    }
  }

  // Polygon / tree のように seed component が無い graph も 1 subproblem として計画する。
  if (subproblems.length === 0) {
    for (const cells of graph.componentCells) {
      if (cells.some((vertex) => starts[vertex]! >= 0)) {
        subproblems.push({ cells: new Set(cells), agents: new Set<number>() });
      }
    }
  }

  const subproblemAt = new Int32Array(map.width * map.height).fill(-1);
  for (let index = 0; index < subproblems.length; index += 1) {
    for (const vertex of subproblems[index]!.cells) subproblemAt[vertex] = index;
  }

  // Algorithm 4.1.2: component 内と boundary から導入可能な agent を割り当てる。
  const assigned = new Int32Array(agents.length).fill(-1);
  for (let subproblemIndex = 0; subproblemIndex < subproblems.length; subproblemIndex += 1) {
    const subproblem = subproblems[subproblemIndex]!;
    for (const vertex of [...subproblem.cells].sort((a, b) => a - b)) {
      const resident = starts[vertex]!;
      const exterior = graph.adjacency[vertex]!.filter((next) => !subproblem.cells.has(next));
      if (exterior.length === 0) {
        assign(resident, subproblemIndex);
        continue;
      }
      for (const outside of exterior) {
        const reachableWithoutOutside = reachable(graph, vertex, new Set([outside]), consume);
        if (!reachableWithoutOutside) return emptyStopped();
        const mPrime = countEmpty(reachableWithoutOutside, starts);
        const reachableWithoutBoundary = reachableFromSet(
          graph,
          subproblem.cells,
          new Set([vertex]),
          consume,
        );
        if (!reachableWithoutBoundary) return emptyStopped();
        const mDouble = countEmpty(reachableWithoutBoundary, starts);
        const component = graph.componentLabels[vertex]!;
        const totalEmpty =
          (graph.componentCells[component]?.length ?? 0) -
          agents.filter((agent) => graph.componentLabels[cellIndex(map, agent.start)] === component)
            .length;
        if ((mPrime >= 1 && mPrime < totalEmpty) || mDouble >= 1) {
          assign(resident, subproblemIndex);
        }

        let remaining = Math.max(0, mPrime - 1);
        if (remaining > 0) {
          const outward = followPathAway(
            graph,
            outside,
            vertex,
            subproblemAt,
            subproblemIndex,
            consume,
          );
          if (!outward) return emptyStopped();
          for (const candidate of outward) {
            const occupant = starts[candidate]!;
            if (occupant < 0) continue;
            assign(occupant, subproblemIndex);
            remaining -= 1;
            if (remaining === 0) break;
          }
        }
      }
    }
  }

  // Algorithm 4.1.3: path の edge goal が別 subproblem agent なら Ci ≺ Cj。
  const edges = new Set<string>();
  const neighboring = new Map<number, Set<number>>();
  for (let index = 0; index < subproblems.length; index += 1) {
    neighboring.set(index, new Set<number>());
  }
  const seenBoundaries = new Set<string>();
  for (let from = 0; from < subproblems.length; from += 1) {
    for (const vertex of [...subproblems[from]!.cells].sort((a, b) => a - b)) {
      for (const outside of graph.adjacency[vertex]!) {
        if (subproblems[from]!.cells.has(outside)) continue;
        const boundary = pathToNextSubproblem(graph, vertex, outside, from, subproblemAt, consume);
        if (boundary === "stopped") return emptyStopped();
        if (!boundary) continue;
        const key = `${from}>${boundary.to}:${boundary.path.join(",")}`;
        if (seenBoundaries.has(key)) continue;
        seenBoundaries.add(key);
        neighboring.get(from)!.add(boundary.to);
        neighboring.get(boundary.to)!.add(from);
        scanPriority(from, boundary.to, boundary.path);
      }
    }
  }

  // Algorithm 4.1.4: relation Ci≺Cj を Cj の branches へ伝播する。
  const originals = [...edges];
  for (const edge of originals) {
    const [higherText, lowerText] = edge.split(">");
    const higher = Number(higherText);
    const lower = Number(lowerText);
    propagate(higher, lower, new Set<number>());
  }

  const priorityEdges = [...edges]
    .map((edge) => edge.split(">").map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const { order: topological, brokeCycle } = topologicalOrder(
    subproblems.length,
    priorityEdges,
    random,
  );
  const order: number[] = [];
  for (const subproblem of topological) {
    const members = [...subproblems[subproblem]!.agents]
      .map((agent) => ({ agent, rank: random() }))
      .sort((a, b) => a.rank - b.rank || a.agent - b.agent)
      .map((item) => item.agent);
    order.push(...members);
  }
  for (let index = 0; index < agents.length; index += 1) {
    if (!order.includes(index)) order.push(index);
  }

  return {
    subproblems: freezeSubproblems(),
    order,
    priorityEdges: priorityEdges.map(([higher, lower]) => ({ higher, lower })),
    stopped: false,
    brokeCycle,
  };

  function assign(agent: number, subproblem: number): void {
    if (agent < 0 || assigned[agent]! >= 0) return;
    assigned[agent] = subproblem;
    subproblems[subproblem]!.agents.add(agent);
  }

  function scanPriority(from: number, to: number, path: readonly number[]): void {
    for (const vertex of path) {
      const goalAgent = goals[vertex]!;
      if (goalAgent < 0 || subproblems[from]!.agents.has(goalAgent)) break;
      if (subproblems[to]!.agents.has(goalAgent)) {
        edges.add(`${from}>${to}`);
        break;
      }
    }
  }

  function propagate(higher: number, lower: number, visited: Set<number>): void {
    if (visited.has(lower)) return;
    visited.add(lower);
    for (const next of neighboring.get(lower) ?? []) {
      if (next === higher || edges.has(`${next}>${lower}`)) continue;
      edges.add(`${lower}>${next}`);
      propagate(lower, next, visited);
    }
  }

  function freezeSubproblems(): PushSubproblem[] {
    return subproblems.map((subproblem, index) => ({
      id: `subproblem-${index}`,
      cells: [...subproblem.cells].sort((a, b) => a - b),
      agentIndices: [...subproblem.agents].sort((a, b) => a - b),
    }));
  }
}

function buildGraph(map: GridMap): GraphData {
  const size = map.width * map.height;
  const walkable: number[] = [];
  const adjacency = Array.from({ length: size }, (_, index) => {
    const cell = indexToCell(map, index);
    if (!isWalkable(map, cell)) return [];
    walkable.push(index);
    return neighbors(map, cell)
      .map((next) => cellIndex(map, next))
      .sort((a, b) => a - b);
  });
  const componentLabels = new Int32Array(size).fill(-1);
  const componentCells: number[][] = [];
  for (const start of walkable) {
    if (componentLabels[start] !== -1) continue;
    const id = componentCells.length;
    const queue = [start];
    const cells: number[] = [];
    componentLabels[start] = id;
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head]!;
      cells.push(current);
      for (const next of adjacency[current]!) {
        if (componentLabels[next] !== -1) continue;
        componentLabels[next] = id;
        queue.push(next);
      }
    }
    componentCells.push(cells);
  }
  return { adjacency, walkable, componentLabels, componentCells };
}

/** Tarjan edge stack。再帰を使わず 40k-cell guard でも JS stack を溢れさせない。 */
function biconnectedComponents(graph: GraphData, consume: () => boolean): Set<number>[] | null {
  const size = graph.adjacency.length;
  const discovery = new Int32Array(size).fill(-1);
  const low = new Int32Array(size);
  const parent = new Int32Array(size).fill(-1);
  let time = 0;
  const components: Set<number>[] = [];
  const edgeStack: [number, number][] = [];

  for (const root of graph.walkable) {
    if (discovery[root] !== -1) continue;
    discovery[root] = low[root] = time++;
    const stack: { vertex: number; next: number }[] = [{ vertex: root, next: 0 }];
    while (stack.length > 0) {
      if (consume()) return null;
      const frame = stack[stack.length - 1]!;
      const adjacent = graph.adjacency[frame.vertex]!;
      if (frame.next < adjacent.length) {
        const next = adjacent[frame.next++]!;
        if (discovery[next] === -1) {
          parent[next] = frame.vertex;
          edgeStack.push([frame.vertex, next]);
          discovery[next] = low[next] = time++;
          stack.push({ vertex: next, next: 0 });
        } else if (next !== parent[frame.vertex] && discovery[next]! < discovery[frame.vertex]!) {
          low[frame.vertex] = Math.min(low[frame.vertex]!, discovery[next]!);
          edgeStack.push([frame.vertex, next]);
        }
        continue;
      }
      stack.pop();
      const p = parent[frame.vertex]!;
      if (p >= 0) {
        low[p] = Math.min(low[p]!, low[frame.vertex]!);
        if (low[frame.vertex]! >= discovery[p]!) {
          const component = new Set<number>();
          while (edgeStack.length > 0) {
            const edge = edgeStack.pop()!;
            component.add(edge[0]);
            component.add(edge[1]);
            if (edge[0] === p && edge[1] === frame.vertex) break;
          }
          components.push(component);
        }
      }
    }
  }
  return components;
}

function shortestBetweenSets(
  graph: GraphData,
  from: ReadonlySet<number>,
  to: ReadonlySet<number>,
  consume: () => boolean,
): number[] | null | "stopped" {
  const parent = new Int32Array(graph.adjacency.length).fill(-2);
  const queue = new Int32Array(graph.adjacency.length);
  let head = 0;
  let tail = 0;
  for (const start of [...from].sort((a, b) => a - b)) {
    parent[start] = -1;
    queue[tail++] = start;
    if (to.has(start)) return [start];
  }
  while (head < tail) {
    if (consume()) return "stopped";
    const current = queue[head++]!;
    for (const next of graph.adjacency[current]!) {
      if (parent[next] !== -2) continue;
      parent[next] = current;
      if (to.has(next)) return reconstruct(parent, next);
      queue[tail++] = next;
    }
  }
  return null;
}

function reachable(
  graph: GraphData,
  start: number,
  blocked: ReadonlySet<number>,
  consume: () => boolean,
): Set<number> | null {
  return reachableFromSet(graph, new Set([start]), blocked, consume);
}

function reachableFromSet(
  graph: GraphData,
  starts: ReadonlySet<number>,
  blocked: ReadonlySet<number>,
  consume: () => boolean,
): Set<number> | null {
  const reached = new Set<number>();
  const queue: number[] = [];
  for (const start of starts) {
    if (!blocked.has(start)) {
      reached.add(start);
      queue.push(start);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    if (consume()) return null;
    const current = queue[head]!;
    for (const next of graph.adjacency[current]!) {
      if (blocked.has(next) || reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}

/** Algorithm 4.1.2 line 9: boundary から次の branch/subproblem まで corridor をたどる。 */
function followPathAway(
  graph: GraphData,
  start: number,
  previous: number,
  subproblemAt: Int32Array,
  sourceSubproblem: number,
  consume: () => boolean,
): number[] | null {
  const path: number[] = [];
  let current = start;
  let before = previous;
  while (true) {
    if (consume()) return null;
    path.push(current);
    const owner = subproblemAt[current]!;
    if (owner >= 0 && owner !== sourceSubproblem) return path;
    const next = graph.adjacency[current]!.filter(
      (vertex) => vertex !== before && subproblemAt[vertex] !== sourceSubproblem,
    );
    if (next.length !== 1) return path;
    before = current;
    current = next[0]!;
  }
}

/** Algorithm 4.1.3 の「別 subproblem への path」。途中の subproblem で必ず止める。 */
function pathToNextSubproblem(
  graph: GraphData,
  boundary: number,
  outside: number,
  sourceSubproblem: number,
  subproblemAt: Int32Array,
  consume: () => boolean,
): { readonly to: number; readonly path: readonly number[] } | null | "stopped" {
  const parent = new Int32Array(graph.adjacency.length).fill(-2);
  const queue = new Int32Array(graph.adjacency.length);
  let head = 0;
  let tail = 0;
  parent[boundary] = -1;
  parent[outside] = boundary;
  queue[tail++] = outside;
  while (head < tail) {
    if (consume()) return "stopped";
    const current = queue[head++]!;
    const owner = subproblemAt[current]!;
    if (owner >= 0 && owner !== sourceSubproblem) {
      return { to: owner, path: reconstruct(parent, current) };
    }
    for (const next of graph.adjacency[current]!) {
      if (parent[next] !== -2 || subproblemAt[next] === sourceSubproblem) continue;
      parent[next] = current;
      queue[tail++] = next;
    }
  }
  return null;
}

function countEmpty(vertices: ReadonlySet<number>, starts: Int32Array): number {
  let count = 0;
  for (const vertex of vertices) if (starts[vertex] === -1) count += 1;
  return count;
}

/**
 * subproblem の優先度関係から並び順を作る。閉路があっても順序は返す。
 *
 * ★ 閉路を「解なし」にしてはいけない。
 *
 *   原論文 Algorithm 4 は毎回「(equal) highest priority の未完了 agent を
 *   randomly select」する方式で、事前に全順序を作ることを要求していない。
 *   解が無いと判定してよいのは Theorem 1 の条件、すなわち swap が失敗した
 *   ときだけであり、優先度関係に閉路があることではない。
 *
 *   以前はここが null を返すと `impossible` として、警告も無しに
 *   no-solution / search-exhausted を返していた。空き頂点がちょうど 2 個の
 *   密な盤面では閉路が普通に起きるので、LaCAM が解ける入力の 6 割で
 *   「解なし」と表示していた。
 *
 *   閉路が残ったら、残りのうち添字の小さいものから順に出して先へ進む。
 *   その先で push / swap が失敗すれば、そちらの経路が但し書き付きで
 *   失敗を返す（それが論文どおりの判定である）。
 */
function topologicalOrder(
  count: number,
  edges: readonly [number, number][],
  random: () => number,
): { readonly order: number[]; readonly brokeCycle: boolean } {
  const indegree = new Int32Array(count);
  const outgoing = Array.from({ length: count }, () => [] as number[]);
  for (const [higher, lower] of edges) {
    if (higher === lower || outgoing[higher]!.includes(lower)) continue;
    outgoing[higher]!.push(lower);
    indegree[lower] = (indegree[lower] ?? 0) + 1;
  }
  const ranks = Array.from({ length: count }, () => random());
  const placed = new Uint8Array(count);
  const ready = Array.from({ length: count }, (_, index) => index).filter(
    (index) => indegree[index] === 0,
  );
  const result: number[] = [];
  let brokeCycle = false;

  const emit = (current: number): void => {
    placed[current] = 1;
    result.push(current);
    for (const next of outgoing[current]!) {
      indegree[next] = (indegree[next] ?? 0) - 1;
      if (indegree[next] === 0 && !placed[next]) ready.push(next);
    }
  };

  while (result.length < count) {
    while (ready.length > 0) {
      ready.sort((a, b) => ranks[a]! - ranks[b]! || a - b);
      const current = ready.shift()!;
      if (placed[current]) continue;
      emit(current);
    }
    if (result.length === count) break;
    // 閉路が残った。残りのうち添字の小さいものを 1 つ出して進める（決定的）。
    const stuck = Array.from({ length: count }, (_, index) => index).find((i) => !placed[i]);
    if (stuck === undefined) break;
    brokeCycle = true;
    emit(stuck);
  }
  return { order: result, brokeCycle };
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

function emptyStopped(): DecompositionResult {
  return { subproblems: [], order: [], priorityEdges: [], stopped: true, brokeCycle: false };
}
