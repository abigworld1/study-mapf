import { describe, expect, it } from "vitest";
import type { Scenario } from "@/lib/model/types";
import { DEFAULT_RULES, DEFAULT_SOLVER_OPTIONS } from "@/lib/model/types";
import { buildPreset, PRESETS } from "@/lib/model/scenario";
import { createEmptyMap, isWalkable, withBlocked } from "@/lib/model/grid";
import { runInline } from "@/solvers/client";
import { createRandom, randomInt } from "@/lib/model/random";
import { checkPaths } from "../helpers/check-paths";

export { checkPaths };

/**
 * 反復テスト。
 * seed を変えながら多数のインスタンスを解き、解が満たすべき性質を毎回検査する。
 * 「solved と返したのに実は不正」という最悪の壊れ方を防ぐのが目的。
 */

/** seed からランダムな小さいインスタンスを作る。壁が開始・目標に被らないようにする。 */
function randomScenario(seed: number): Scenario {
  const random = createRandom(seed);
  const w = 6 + randomInt(random, 5);
  const h = 6 + randomInt(random, 5);
  let map = createEmptyMap(w, h);
  const wallCount = randomInt(random, Math.floor(w * h * 0.2));
  for (let i = 0; i < wallCount; i += 1) {
    map = withBlocked(map, { x: randomInt(random, w), y: randomInt(random, h) }, true);
  }

  const free: { x: number; y: number }[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (isWalkable(map, { x, y })) free.push({ x, y });
    }
  }
  const agentCount = Math.min(
    4,
    Math.max(1, randomInt(random, 4) + 1),
    Math.floor(free.length / 2),
  );
  const used = new Set<string>();
  const pick = () => {
    for (let tries = 0; tries < 200; tries += 1) {
      const c = free[randomInt(random, free.length)]!;
      const key = `${c.x},${c.y}`;
      if (!used.has(key)) {
        used.add(key);
        return c;
      }
    }
    return null;
  };

  const agents = [];
  for (let i = 0; i < agentCount; i += 1) {
    const start = pick();
    const goal = pick();
    if (!start || !goal) break;
    agents.push({ id: `a${i + 1}`, start, goal, colorIndex: i });
  }

  return {
    id: `rand-${seed}`,
    name: `random ${seed}`,
    kind: "one-shot-mapf",
    map,
    agents,
    rules: DEFAULT_RULES,
    seed,
  };
}

describe("解の不変条件（反復テスト）", () => {
  it("優先順位付き計画が solved を返すとき、経路は常に妥当", async () => {
    let solvedCount = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const scenario = randomScenario(seed);
      if (scenario.agents.length === 0) continue;
      const result = await runInline({ solverId: "prioritized-planning", scenario });
      if (result.outcome !== "solved") continue;
      solvedCount += 1;
      const violations = checkPaths(scenario, result.paths);
      expect(violations, `seed=${seed}: ${JSON.stringify(violations.slice(0, 3))}`).toEqual([]);
    }
    // 全部失敗していたらテストとして意味が無いので、最低限解けていることを確認する
    expect(solvedCount).toBeGreaterThan(10);
  });

  it("プリセットでも同じ性質が成り立つ", async () => {
    for (const preset of PRESETS) {
      for (const seed of [1, 2, 3]) {
        const scenario = preset.build(seed);
        const result = await runInline({ solverId: "prioritized-planning", scenario });
        if (result.outcome !== "solved") continue;
        expect(checkPaths(scenario, result.paths), `${preset.id} seed=${seed}`).toEqual([]);
      }
    }
  });

  it("A* の結果は個別最適だが、衝突条件は満たさないことがある", async () => {
    const scenario = buildPreset("swap-conflict", 1);
    const result = await runInline({ solverId: "astar", scenario });
    const violations = checkPaths(scenario, result.paths);
    // 壁通過や跳躍は起きない
    expect(violations.filter((v) => v.rule === "壁を通過")).toHaveLength(0);
    expect(violations.filter((v) => v.rule === "隣接しないセルへ移動")).toHaveLength(0);
    // ただし衝突は起きる（この手法の性質）
    expect(violations.some((v) => v.rule === "同時刻に同じセル" || v.rule === "edge swap")).toBe(
      true,
    );
  });

  it("CBS Batch 2 の各 Solver が solved を返すとき、経路は常に妥当", async () => {
    for (const solverId of ["cbs", "bcbs", "ecbs", "icbs", "eecbs"] as const) {
      let solvedCount = 0;
      for (let seed = 1; seed <= 12; seed += 1) {
        const scenario = randomScenario(seed);
        if (scenario.agents.length === 0) continue;
        const result = await runInline({
          solverId,
          scenario,
          options: {
            ...DEFAULT_SOLVER_OPTIONS,
            maxExpansions: 200_000,
            ...(solverId === "cbs" || solverId === "icbs" ? {} : { suboptimalityFactor: 1.5 }),
          },
        });
        if (result.outcome !== "solved") continue;
        solvedCount += 1;
        expect(checkPaths(scenario, result.paths), `${solverId} seed=${seed}`).toEqual([]);
      }
      expect(solvedCount, `${solverId} が一件も solved を返していない`).toBeGreaterThan(0);
    }
  });

  it("Batch 3 の各 Solver が solved を返すとき、経路は常に妥当", async () => {
    for (const solverId of ["pbs", "pibt", "winpibt"] as const) {
      let solvedCount = 0;
      for (let seed = 1; seed <= 10; seed += 1) {
        const scenario = randomScenario(seed);
        if (scenario.agents.length === 0) continue;
        const result = await runInline({
          solverId,
          scenario,
          options: {
            ...DEFAULT_SOLVER_OPTIONS,
            maxExpansions: 100_000,
            ...(solverId === "winpibt"
              ? { extra: { windowSize: 3, maxTimesteps: 200 } }
              : solverId === "pibt"
                ? { extra: { maxTimesteps: 200 } }
                : {}),
          },
        });
        if (result.outcome !== "solved") continue;
        solvedCount += 1;
        expect(checkPaths(scenario, result.paths), `${solverId} seed=${seed}`).toEqual([]);
      }
      expect(solvedCount, `${solverId} が一件も solved を返していない`).toBeGreaterThan(0);
    }
  });
});
