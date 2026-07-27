import { describe, expect, it } from "vitest";
import type { Scenario, TimedPath } from "@/lib/model/types";
import { DEFAULT_RULES } from "@/lib/model/types";
import { buildPreset, PRESETS } from "@/lib/model/scenario";
import { cellEquals, createEmptyMap, isWalkable, withBlocked } from "@/lib/model/grid";
import { positionAt } from "@/lib/model/conflicts";
import { runInline } from "@/solvers/client";
import { createRandom, randomInt } from "@/lib/model/random";

/**
 * 反復テスト。
 * seed を変えながら多数のインスタンスを解き、解が満たすべき性質を毎回検査する。
 * 「solved と返したのに実は不正」という最悪の壊れ方を防ぐのが目的。
 */

interface Violation {
  rule: string;
  detail: string;
}

function checkPaths(scenario: Scenario, paths: readonly TimedPath[]): Violation[] {
  const violations: Violation[] = [];
  const rules = scenario.rules;

  for (const path of paths) {
    const positions = path.positions;
    if (positions.length === 0) {
      violations.push({ rule: "空の経路", detail: path.agentId });
      continue;
    }

    // 開始位置が一致しているか
    const agent = scenario.agents.find((a) => a.id === path.agentId);
    if (agent && !cellEquals(positions[0]!.cell, agent.start)) {
      violations.push({ rule: "開始位置が違う", detail: path.agentId });
    }

    for (let i = 0; i < positions.length; i += 1) {
      const p = positions[i]!;

      // 壁を通らない
      if (!isWalkable(scenario.map, p.cell)) {
        violations.push({ rule: "壁を通過", detail: `${path.agentId}@t${p.time}` });
      }

      // 時刻が 1 ずつ増える
      if (i > 0 && p.time !== positions[i - 1]!.time + 1) {
        violations.push({ rule: "時刻が連続していない", detail: `${path.agentId}@t${p.time}` });
      }

      // 隣接しないセルへ跳ばない
      if (i > 0) {
        const prev = positions[i - 1]!;
        const dx = Math.abs(p.cell.x - prev.cell.x);
        const dy = Math.abs(p.cell.y - prev.cell.y);
        const ok = rules.allowDiagonal ? dx <= 1 && dy <= 1 : dx + dy <= 1;
        if (!ok) {
          violations.push({ rule: "隣接しないセルへ移動", detail: `${path.agentId}@t${p.time}` });
        }
      }
    }

    // ゴールへ到達している
    if (agent?.goal) {
      const last = positions[positions.length - 1]!;
      if (!cellEquals(last.cell, agent.goal)) {
        violations.push({ rule: "ゴール未到達", detail: path.agentId });
      }
    }
  }

  // 同時刻に同じセルを占有しない / 入れ替わらない
  const horizon = Math.max(0, ...paths.map((p) => p.positions[p.positions.length - 1]?.time ?? 0));
  for (let t = 0; t <= horizon; t += 1) {
    const seen = new Map<string, string>();
    for (const path of paths) {
      const cell = positionAt(path, t, rules);
      if (!cell) continue;
      const key = `${cell.x},${cell.y}`;
      const other = seen.get(key);
      if (other) {
        violations.push({ rule: "同時刻に同じセル", detail: `${other}/${path.agentId}@t${t}` });
      }
      seen.set(key, path.agentId);
    }
    if (t === 0 || !rules.forbidEdgeSwap) continue;
    for (let i = 0; i < paths.length; i += 1) {
      for (let j = i + 1; j < paths.length; j += 1) {
        const a = paths[i]!;
        const b = paths[j]!;
        const aPrev = positionAt(a, t - 1, rules);
        const aNow = positionAt(a, t, rules);
        const bPrev = positionAt(b, t - 1, rules);
        const bNow = positionAt(b, t, rules);
        if (!aPrev || !aNow || !bPrev || !bNow) continue;
        if (cellEquals(aPrev, bNow) && cellEquals(aNow, bPrev) && !cellEquals(aPrev, aNow)) {
          violations.push({ rule: "edge swap", detail: `${a.agentId}/${b.agentId}@t${t}` });
        }
      }
    }
  }

  return violations;
}

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
});
