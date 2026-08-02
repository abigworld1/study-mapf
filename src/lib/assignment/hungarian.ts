/**
 * Hungarian method for a rectangular minimum-cost assignment problem.
 *
 * This is an independent implementation of the primal-dual O(n^2 m) method.
 * `Infinity` entries are forbidden pairs.  The returned assignment contains
 * at most one column per row; rectangular matrices therefore support both
 * unassigned rows and unassigned columns.
 */

export interface AssignmentSolution {
  readonly assignment: readonly (number | null)[];
  readonly cost: number;
}

const EPS = 1e-9;

export function hungarianMethod(costs: readonly (readonly number[])[]): AssignmentSolution | null {
  const rows = costs.length;
  const columns = costs[0]?.length ?? 0;
  if (rows === 0 || columns === 0) return { assignment: [], cost: 0 };
  if (costs.some((row) => row.length !== columns)) return null;

  // The classical implementation assumes rows <= columns.  Transposition
  // preserves deterministic row-major tie-breaking and lets callers use
  // either rectangular orientation.
  if (rows <= columns) return solveRowsToColumns(costs);
  const transposed = Array.from({ length: columns }, (_, col) =>
    Array.from({ length: rows }, (_, row) => costs[row]![col]!),
  );
  const reverse = solveRowsToColumns(transposed);
  if (!reverse) return null;
  const assignment: (number | null)[] = Array.from({ length: rows }, () => null);
  for (const [transposedRow, originalColumn] of reverse.assignment.entries()) {
    if (originalColumn !== null) assignment[originalColumn] = transposedRow;
  }
  return { assignment, cost: reverse.cost };
}

function solveRowsToColumns(costs: readonly (readonly number[])[]): AssignmentSolution | null {
  const n = costs.length;
  const m = costs[0]?.length ?? 0;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    const minv = new Array<number>(m + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(m + 1).fill(false);
    let j0 = 0;
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;
      for (let j = 1; j <= m; j += 1) {
        if (used[j]) continue;
        const value = costs[i0 - 1]?.[j - 1] ?? Number.POSITIVE_INFINITY;
        if (!Number.isFinite(value)) continue;
        const cur = value - u[i0]! - v[j]!;
        if (cur < minv[j]! - EPS || (Math.abs(cur - minv[j]!) <= EPS && j0 < way[j]!)) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta - EPS || (Math.abs(minv[j]! - delta) <= EPS && j < j1)) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      if (!Number.isFinite(delta)) return null;
      for (let j = 0; j <= m; j += 1) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment: (number | null)[] = Array.from({ length: n }, () => null);
  for (let j = 1; j <= m; j += 1) {
    const row = p[j]! - 1;
    if (row >= 0) assignment[row] = j - 1;
  }
  let cost = 0;
  for (let row = 0; row < n; row += 1) {
    const column = assignment[row];
    if (column === null) return null;
    const value = costs[row]?.[column!] ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(value)) return null;
    cost += value;
  }
  return { assignment, cost };
}

export function assignmentCost(
  costs: readonly (readonly number[])[],
  assignment: readonly (number | null)[],
): number {
  return assignment.reduce<number>((sum, column, row) => {
    if (column === null) return sum;
    return sum + (costs[row]?.[column!] ?? Number.POSITIVE_INFINITY);
  }, 0);
}
