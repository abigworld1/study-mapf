import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, type SimulationRules, type TimedPath } from "@/lib/model/types";
import { detectConflicts, makespanOf, positionAt, sumOfCosts } from "@/lib/model/conflicts";

const path = (agentId: string, cells: [number, number][]): TimedPath => ({
  agentId,
  positions: cells.map(([x, y], time) => ({ time, cell: { x, y } })),
});

describe("vertex conflict", () => {
  it("同時刻に同じセルへ居ると検出する", () => {
    const a = path("a", [
      [0, 0],
      [1, 0],
    ]);
    const b = path("b", [
      [2, 0],
      [1, 0],
    ]);
    const conflicts = detectConflicts([a, b], DEFAULT_RULES);
    expect(conflicts.some((c) => c.kind === "vertex" && c.time === 1)).toBe(true);
  });

  it("同じセルを通っても時刻がずれていれば衝突しない", () => {
    // b は (1,0) を時刻 0 に通り、a は同じ (1,0) を時刻 1 に通る
    const a = path("a", [
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    const b = path("b", [
      [1, 0],
      [1, 1],
      [1, 2],
    ]);
    const conflicts = detectConflicts([a, b], DEFAULT_RULES);
    expect(conflicts.filter((c) => c.kind === "vertex")).toHaveLength(0);
  });
});

describe("edge-swap conflict", () => {
  it("隣接 2 体の入れ替わりを検出する", () => {
    const a = path("a", [
      [0, 0],
      [1, 0],
    ]);
    const b = path("b", [
      [1, 0],
      [0, 0],
    ]);
    const conflicts = detectConflicts([a, b], DEFAULT_RULES);
    expect(conflicts.some((c) => c.kind === "edge-swap")).toBe(true);
  });

  it("forbidEdgeSwap を切ると検出しない", () => {
    const rules: SimulationRules = { ...DEFAULT_RULES, forbidEdgeSwap: false };
    const a = path("a", [
      [0, 0],
      [1, 0],
    ]);
    const b = path("b", [
      [1, 0],
      [0, 0],
    ]);
    const conflicts = detectConflicts([a, b], rules);
    expect(conflicts.some((c) => c.kind === "edge-swap")).toBe(false);
  });

  it("両方が待機している場合は入れ替わりではない", () => {
    const a = path("a", [
      [0, 0],
      [0, 0],
    ]);
    const b = path("b", [
      [1, 0],
      [1, 0],
    ]);
    expect(detectConflicts([a, b], DEFAULT_RULES)).toHaveLength(0);
  });
});

describe("following conflict", () => {
  it("既定では検出しない", () => {
    const a = path("a", [
      [1, 0],
      [2, 0],
    ]);
    const b = path("b", [
      [0, 0],
      [1, 0],
    ]);
    expect(detectConflicts([a, b], DEFAULT_RULES).some((c) => c.kind === "following")).toBe(false);
  });

  it("forbidFollowing を有効にすると検出する", () => {
    const rules: SimulationRules = { ...DEFAULT_RULES, forbidFollowing: true };
    const a = path("a", [
      [1, 0],
      [2, 0],
    ]);
    const b = path("b", [
      [0, 0],
      [1, 0],
    ]);
    expect(detectConflicts([a, b], rules).some((c) => c.kind === "following")).toBe(true);
  });
});

describe("goal 到達後の扱い", () => {
  it("stay ではゴールに留まり続け、後から来た相手と衝突する", () => {
    const a = path("a", [[0, 0]]); // 時刻 0 で終わり、以後 (0,0) に留まる
    const b = path("b", [
      [2, 0],
      [1, 0],
      [0, 0],
    ]);
    const conflicts = detectConflicts([a, b], { ...DEFAULT_RULES, goalBehavior: "stay" });
    expect(conflicts.some((c) => c.kind === "vertex" && c.time === 2)).toBe(true);
  });

  it("disappear では消えるので衝突しない", () => {
    const a = path("a", [[0, 0]]);
    const b = path("b", [
      [2, 0],
      [1, 0],
      [0, 0],
    ]);
    const conflicts = detectConflicts([a, b], { ...DEFAULT_RULES, goalBehavior: "disappear" });
    expect(conflicts).toHaveLength(0);
  });

  it("positionAt は disappear で null を返す", () => {
    const a = path("a", [[0, 0]]);
    expect(positionAt(a, 5, { ...DEFAULT_RULES, goalBehavior: "disappear" })).toBeNull();
    expect(positionAt(a, 5, DEFAULT_RULES)).toEqual({ x: 0, y: 0 });
  });
});

describe("コスト", () => {
  it("makespan は最大の終了時刻", () => {
    const a = path("a", [
      [0, 0],
      [1, 0],
    ]);
    const b = path("b", [
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    expect(makespanOf([a, b])).toBe(2);
  });

  it("sum of costs はゴール到達時刻の総和。到達後の待機は数えない", () => {
    // a は時刻 1 で (1,0) に着き、そのあと待機している
    const a: TimedPath = {
      agentId: "a",
      positions: [
        { time: 0, cell: { x: 0, y: 0 } },
        { time: 1, cell: { x: 1, y: 0 } },
        { time: 2, cell: { x: 1, y: 0 } },
        { time: 3, cell: { x: 1, y: 0 } },
      ],
    };
    expect(sumOfCosts([a])).toBe(1);
  });
});
