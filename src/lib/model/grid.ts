import type { Cell, GridMap, MoveDirection, SimulationRules } from "./types.js";

/** index = y * width + x。Worker への転送を安くするため 1 次元配列で持つ。 */
export function cellIndex(map: GridMap, cell: Cell): number {
  return cell.y * map.width + cell.x;
}

export function indexToCell(map: GridMap, index: number): Cell {
  return { x: index % map.width, y: Math.floor(index / map.width) };
}

export function isInside(map: GridMap, cell: Cell): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < map.width && cell.y < map.height;
}

export function isBlocked(map: GridMap, cell: Cell): boolean {
  if (!isInside(map, cell)) return true;
  return map.blocked[cellIndex(map, cell)] === true;
}

export function isWalkable(map: GridMap, cell: Cell): boolean {
  return !isBlocked(map, cell);
}

export function cellEquals(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Map/Set のキーに使う安定した文字列。 */
export function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

export function timeKey(cell: Cell, time: number): string {
  return `${cell.x},${cell.y}@${time}`;
}

const ORTHOGONAL: readonly { dir: MoveDirection; dx: number; dy: number }[] = [
  { dir: "up", dx: 0, dy: -1 },
  { dir: "down", dx: 0, dy: 1 },
  { dir: "left", dx: -1, dy: 0 },
  { dir: "right", dx: 1, dy: 0 },
];

const DIAGONAL: readonly { dx: number; dy: number }[] = [
  { dx: -1, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: 1, dy: 1 },
];

/**
 * 移動可能な隣接セル。wait は含めない。
 * allowDiagonal は既定 false（4 近傍）。
 */
export function neighbors(
  map: GridMap,
  cell: Cell,
  rules?: Pick<SimulationRules, "allowDiagonal">,
): Cell[] {
  const out: Cell[] = [];
  for (const { dx, dy } of ORTHOGONAL) {
    const next = { x: cell.x + dx, y: cell.y + dy };
    if (isWalkable(map, next)) out.push(next);
  }
  if (rules?.allowDiagonal) {
    for (const { dx, dy } of DIAGONAL) {
      const next = { x: cell.x + dx, y: cell.y + dy };
      // 角抜けを禁止する。両側が塞がっていたら通れない。
      if (!isWalkable(map, next)) continue;
      if (
        isBlocked(map, { x: cell.x + dx, y: cell.y }) &&
        isBlocked(map, { x: cell.x, y: cell.y + dy })
      ) {
        continue;
      }
      out.push(next);
    }
  }
  return out;
}

/** wait を含めた遷移候補。時空間探索で使う。 */
export function movesWithWait(
  map: GridMap,
  cell: Cell,
  rules?: Pick<SimulationRules, "allowDiagonal">,
): Cell[] {
  return [cell, ...neighbors(map, cell, rules)];
}

export function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function isAdjacentOrSame(a: Cell, b: Cell, allowDiagonal = false): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  if (dx === 0 && dy === 0) return true;
  if (allowDiagonal) return dx <= 1 && dy <= 1;
  return dx + dy === 1;
}

export function createEmptyMap(width: number, height: number): GridMap {
  return { width, height, blocked: new Array<boolean>(width * height).fill(false) };
}

/** blocked は readonly なので、編集時は新しい配列を作る。 */
export function withBlocked(map: GridMap, cell: Cell, blocked: boolean): GridMap {
  if (!isInside(map, cell)) return map;
  const next = map.blocked.slice();
  next[cellIndex(map, cell)] = blocked;
  return { ...map, blocked: next };
}

export function resizeMap(map: GridMap, width: number, height: number): GridMap {
  const blocked = new Array<boolean>(width * height).fill(false);
  for (let y = 0; y < Math.min(height, map.height); y += 1) {
    for (let x = 0; x < Math.min(width, map.width); x += 1) {
      blocked[y * width + x] = map.blocked[y * map.width + x] === true;
    }
  }
  return { width, height, blocked };
}

/**
 * 単一エージェントの真距離（壁を考慮、他エージェント無視）を BFS で全セル分求める。
 * A* の許容ヒューリスティクスとして使える。
 * 到達不能なセルは Infinity。
 */
export function trueDistanceFrom(map: GridMap, goal: Cell): Float64Array {
  const size = map.width * map.height;
  const dist = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
  if (!isWalkable(map, goal)) return dist;

  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  const start = cellIndex(map, goal);
  dist[start] = 0;
  queue[tail++] = start;

  while (head < tail) {
    const current = queue[head++]!;
    const cell = indexToCell(map, current);
    const base = dist[current]!;
    for (const { dx, dy } of ORTHOGONAL) {
      const next = { x: cell.x + dx, y: cell.y + dy };
      if (!isWalkable(map, next)) continue;
      const ni = cellIndex(map, next);
      if (dist[ni] !== Number.POSITIVE_INFINITY) continue;
      dist[ni] = base + 1;
      queue[tail++] = ni;
    }
  }
  return dist;
}

export function lookupDistance(map: GridMap, dist: Float64Array, cell: Cell): number {
  if (!isInside(map, cell)) return Number.POSITIVE_INFINITY;
  return dist[cellIndex(map, cell)] ?? Number.POSITIVE_INFINITY;
}
