/**
 * 決定性のある乱数。
 *
 * ★ Solver の中で Math.random() を使ってはならない。
 *   「同じ seed と同じ入力なら同じ結果」という要件を満たせなくなる。
 *   SolverContext.random() を使うこと。
 *
 * mulberry32。32bit seed、周期 2^32、統計的性質は教材用途には十分。
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [0, max) の整数。 */
export function randomInt(random: () => number, max: number): number {
  return Math.floor(random() * max);
}

/** 破壊的にシャッフルする。LNS の近傍選択などで使う。 */
export function shuffleInPlace<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(random, i + 1);
    const a = items[i]!;
    const b = items[j]!;
    items[i] = b;
    items[j] = a;
  }
  return items;
}

export function pickOne<T>(items: readonly T[], random: () => number): T | undefined {
  if (items.length === 0) return undefined;
  return items[randomInt(random, items.length)];
}
