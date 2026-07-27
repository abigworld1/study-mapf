import { describe, expect, it } from "vitest";
import type { Scenario } from "@/lib/model/types";
import { DEFAULT_RULES } from "@/lib/model/types";
import { createEmptyMap, withBlocked } from "@/lib/model/grid";
import { detectConflicts, makespanOf, sumOfCosts } from "@/lib/model/conflicts";
import { buildPreset } from "@/lib/model/scenario";
import { runInline } from "@/solvers/client";
import {
  ReferenceSolverTooLarge,
  jointStateBfs,
  jointStateOptimalSumOfCosts,
} from "@/solvers/reference/joint-state";

/**
 * 参照ソルバ（オラクル）自体のテスト。
 *
 * ★ オラクルが間違っていると、最適解法の検証が全部無意味になる。
 *   ここは手計算できる極小例だけで固める。
 */

function scenario(
  width: number,
  height: number,
  agents: [[number, number], [number, number]][],
  walls: [number, number][] = [],
): Scenario {
  let map = createEmptyMap(width, height);
  for (const [x, y] of walls) map = withBlocked(map, { x, y }, true);
  return {
    id: "t",
    name: "t",
    kind: "one-shot-mapf",
    map,
    agents: agents.map(([s, g], i) => ({
      id: `a${i + 1}`,
      start: { x: s[0], y: s[1] },
      goal: { x: g[0], y: g[1] },
      colorIndex: i,
    })),
    rules: DEFAULT_RULES,
    seed: 1,
  };
}

describe("参照ソルバ: makespan 最適", () => {
  it("1 体・直線は手計算と一致する", () => {
    const res = jointStateBfs(
      scenario(4, 1, [
        [
          [0, 0],
          [3, 0],
        ],
      ]),
    );
    expect(res.solved).toBe(true);
    expect(res.makespan).toBe(3);
  });

  it("すれ違いに退避が要る場合も解ける", () => {
    // y=1 が通路、(3,0) だけ退避できる
    const walls: [number, number][] = [];
    for (let x = 0; x < 5; x += 1) {
      walls.push([x, 0]);
      walls.push([x, 2]);
    }
    const s = scenario(
      5,
      3,
      [
        [
          [0, 1],
          [4, 1],
        ],
        [
          [4, 1],
          [0, 1],
        ],
      ],
      walls.filter(([x, y]) => !(x === 3 && y === 0)),
    );
    const res = jointStateBfs(s);
    expect(res.solved).toBe(true);
    expect(detectConflicts(res.paths, s.rules)).toHaveLength(0);
  });

  it("退避場所が無い 1 本道は解けないと判定する", () => {
    const s = scenario(4, 1, [
      [
        [0, 0],
        [3, 0],
      ],
      [
        [3, 0],
        [0, 0],
      ],
    ]);
    const res = jointStateBfs(s, 12);
    expect(res.solved).toBe(false);
  });

  it("大きすぎる入力は例外を投げる（黙って間違えない）", () => {
    const big = buildPreset("warehouse", 1);
    expect(() => jointStateBfs(big)).toThrow(ReferenceSolverTooLarge);
  });
});

describe("参照ソルバ: sum of costs 最適", () => {
  it("2 体がすれ違わずに済む場合、SOC は個別最短の和", () => {
    const s = scenario(4, 2, [
      [
        [0, 0],
        [3, 0],
      ],
      [
        [0, 1],
        [3, 1],
      ],
    ]);
    const res = jointStateOptimalSumOfCosts(s, 6);
    expect(res.solved).toBe(true);
    expect(res.sumOfCostsCertified).toBe(true);
    expect(res.sumOfCosts).toBe(6); // 3 + 3
  });

  it("干渉があると SOC は個別最短の和より大きくなる", () => {
    // 幅 1 の通路 + 退避 1 マス。すれ違いに待機が要る
    const walls: [number, number][] = [];
    for (let x = 0; x < 5; x += 1) {
      walls.push([x, 0]);
      walls.push([x, 2]);
    }
    const s = scenario(
      5,
      3,
      [
        [
          [0, 1],
          [4, 1],
        ],
        [
          [4, 1],
          [0, 1],
        ],
      ],
      walls.filter(([x, y]) => !(x === 3 && y === 0)),
    );
    const res = jointStateOptimalSumOfCosts(s, 8);
    expect(res.solved).toBe(true);
    expect(res.sumOfCosts).toBeGreaterThan(8); // 個別最短は 4 + 4
    expect(detectConflicts(res.paths, s.rules)).toHaveLength(0);
  });

  it("返す経路は不変条件を満たす", () => {
    const s = scenario(3, 3, [
      [
        [0, 0],
        [2, 2],
      ],
      [
        [2, 0],
        [0, 2],
      ],
    ]);
    const res = jointStateOptimalSumOfCosts(s, 6);
    expect(res.solved).toBe(true);
    expect(detectConflicts(res.paths, s.rules)).toHaveLength(0);
    expect(sumOfCosts(res.paths)).toBe(res.sumOfCosts);
    expect(makespanOf(res.paths)).toBe(res.makespan);
  });
});

describe("参照ソルバとの突き合わせ", () => {
  it("優先順位付き計画は最適以上のコストになる（下回ることはない）", async () => {
    const cases: Scenario[] = [
      scenario(4, 2, [
        [
          [0, 0],
          [3, 0],
        ],
        [
          [0, 1],
          [3, 1],
        ],
      ]),
      scenario(3, 3, [
        [
          [0, 0],
          [2, 2],
        ],
        [
          [2, 0],
          [0, 2],
        ],
      ]),
      scenario(4, 3, [
        [
          [0, 0],
          [3, 2],
        ],
        [
          [3, 0],
          [0, 2],
        ],
        [
          [0, 2],
          [3, 0],
        ],
      ]),
    ];

    for (const s of cases) {
      const optimal = jointStateOptimalSumOfCosts(s, 8);
      if (!optimal.solved || !optimal.sumOfCostsCertified) continue;
      const pp = await runInline({ solverId: "prioritized-planning", scenario: s });
      if (pp.outcome !== "solved") continue;
      // 最適より小さいコストが出たら、どちらかが壊れている
      expect(pp.metrics.sumOfCosts).toBeGreaterThanOrEqual(optimal.sumOfCosts);
    }
  });
});
