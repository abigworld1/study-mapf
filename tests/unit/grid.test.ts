import { describe, expect, it } from "vitest";
import {
  cellEquals,
  cellIndex,
  createEmptyMap,
  indexToCell,
  isBlocked,
  isWalkable,
  lookupDistance,
  manhattan,
  movesWithWait,
  neighbors,
  resizeMap,
  trueDistanceFrom,
  withBlocked,
} from "@/lib/model/grid";

describe("グリッド座標", () => {
  const map = createEmptyMap(5, 3);

  it("index と Cell を相互変換できる", () => {
    expect(cellIndex(map, { x: 0, y: 0 })).toBe(0);
    expect(cellIndex(map, { x: 4, y: 2 })).toBe(14);
    expect(indexToCell(map, 14)).toEqual({ x: 4, y: 2 });
    expect(indexToCell(map, 7)).toEqual({ x: 2, y: 1 });
  });

  it("範囲外は通行不可として扱う", () => {
    expect(isBlocked(map, { x: -1, y: 0 })).toBe(true);
    expect(isBlocked(map, { x: 5, y: 0 })).toBe(true);
    expect(isBlocked(map, { x: 0, y: 3 })).toBe(true);
    expect(isWalkable(map, { x: 4, y: 2 })).toBe(true);
  });

  it("withBlocked は元のマップを壊さない", () => {
    const blocked = withBlocked(map, { x: 1, y: 1 }, true);
    expect(isBlocked(blocked, { x: 1, y: 1 })).toBe(true);
    expect(isBlocked(map, { x: 1, y: 1 })).toBe(false);
  });

  it("resizeMap は重なる範囲の壁を保つ", () => {
    const withWall = withBlocked(map, { x: 1, y: 1 }, true);
    const larger = resizeMap(withWall, 8, 6);
    expect(larger.width).toBe(8);
    expect(isBlocked(larger, { x: 1, y: 1 })).toBe(true);
    const smaller = resizeMap(withWall, 2, 2);
    expect(isBlocked(smaller, { x: 1, y: 1 })).toBe(true);
  });
});

describe("隣接と移動", () => {
  it("既定では 4 近傍のみ（斜めなし）", () => {
    const map = createEmptyMap(3, 3);
    const list = neighbors(map, { x: 1, y: 1 });
    expect(list).toHaveLength(4);
    expect(list.some((c) => c.x === 0 && c.y === 0)).toBe(false);
  });

  it("壁は隣接に含めない", () => {
    let map = createEmptyMap(3, 3);
    map = withBlocked(map, { x: 0, y: 1 }, true);
    expect(neighbors(map, { x: 1, y: 1 })).toHaveLength(3);
  });

  it("端では隣接が減る", () => {
    const map = createEmptyMap(3, 3);
    expect(neighbors(map, { x: 0, y: 0 })).toHaveLength(2);
  });

  it("movesWithWait は自セルを先頭に含む", () => {
    const map = createEmptyMap(3, 3);
    const moves = movesWithWait(map, { x: 1, y: 1 });
    expect(moves).toHaveLength(5);
    expect(cellEquals(moves[0]!, { x: 1, y: 1 })).toBe(true);
  });

  it("allowDiagonal で斜めが増えるが、角抜けは禁止", () => {
    let map = createEmptyMap(3, 3);
    const rules = { allowDiagonal: true };
    expect(neighbors(map, { x: 1, y: 1 }, rules)).toHaveLength(8);
    // 左と上を塞ぐと、左上への角抜けはできない
    map = withBlocked(map, { x: 0, y: 1 }, true);
    map = withBlocked(map, { x: 1, y: 0 }, true);
    const list = neighbors(map, { x: 1, y: 1 }, rules);
    expect(list.some((c) => c.x === 0 && c.y === 0)).toBe(false);
  });
});

describe("真距離", () => {
  it("壁を迂回した距離になる", () => {
    let map = createEmptyMap(5, 3);
    for (let y = 0; y < 2; y += 1) map = withBlocked(map, { x: 2, y }, true);
    const dist = trueDistanceFrom(map, { x: 4, y: 0 });
    // 直線なら 4 だが、壁があるので下段を回る必要がある
    expect(lookupDistance(map, dist, { x: 0, y: 0 })).toBeGreaterThan(
      manhattan({ x: 0, y: 0 }, { x: 4, y: 0 }),
    );
  });

  it("到達できないセルは Infinity", () => {
    let map = createEmptyMap(3, 1);
    map = withBlocked(map, { x: 1, y: 0 }, true);
    const dist = trueDistanceFrom(map, { x: 0, y: 0 });
    expect(lookupDistance(map, dist, { x: 2, y: 0 })).toBe(Number.POSITIVE_INFINITY);
  });
});
