import { describe, expect, it } from "vitest";
import { DEFAULT_SOLVER_OPTIONS, type Scenario } from "@/lib/model/types";
import { buildPreset, PRESETS, validateScenario } from "@/lib/model/scenario";
import { detectConflicts } from "@/lib/model/conflicts";
import { createEmptyMap, withBlocked, isWalkable, cellEquals } from "@/lib/model/grid";
import { getSolver, listSolvers } from "@/solvers/registry";
import { createRecordingContext } from "@/solvers/context";
import { runInline } from "@/solvers/client";
import { SimpleReservationTable } from "@/lib/model/reservation";
import { spaceTimeAStar } from "@/solvers/low-level/space-time-astar";
import { DEFAULT_RULES } from "@/lib/model/types";

async function solve(solverId: string, scenario: Scenario) {
  const solver = getSolver(solverId);
  expect(solver, `${solverId} が registry に無い`).toBeDefined();
  const { context, events } = createRecordingContext(scenario.seed);
  const result = await solver!.solve(scenario, DEFAULT_SOLVER_OPTIONS, context);
  return { result, events };
}

describe("registry", () => {
  it("登録されている Solver の id が重複しない", () => {
    const ids = listSolvers().map((s) => s.metadata.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("未実装の id を要求しても例外を投げず、構造化エラーを返す", async () => {
    const result = await runInline({
      solverId: "not-a-real-solver",
      scenario: buildPreset("open-grid", 1),
    });
    expect(result.outcome).toBe("error");
    expect(result.error?.code).toBe("not-implemented");
  });
});

describe("A*（各エージェント独立）", () => {
  it("個別最短経路を返す", async () => {
    const map = createEmptyMap(5, 1);
    const scenario: Scenario = {
      id: "t",
      name: "t",
      kind: "one-shot-mapf",
      map,
      agents: [{ id: "a1", start: { x: 0, y: 0 }, goal: { x: 4, y: 0 } }],
      rules: DEFAULT_RULES,
      seed: 1,
    };
    const { result } = await solve("astar", scenario);
    expect(result.outcome).toBe("solved");
    expect(result.metrics.sumOfCosts).toBe(4);
  });

  it("衝突を解消しない（Swap Conflict で衝突が残る）", async () => {
    const scenario = buildPreset("swap-conflict", 1);
    const { result } = await solve("astar", scenario);
    expect(result.outcome).toBe("solved");
    // これは実装の不具合ではなく、この手法が衝突を扱わないため
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it("到達不能なら no-solution", async () => {
    let map = createEmptyMap(3, 1);
    map = withBlocked(map, { x: 1, y: 0 }, true);
    const scenario: Scenario = {
      id: "t",
      name: "t",
      kind: "one-shot-mapf",
      map,
      agents: [{ id: "a1", start: { x: 0, y: 0 }, goal: { x: 2, y: 0 } }],
      rules: DEFAULT_RULES,
      seed: 1,
    };
    const { result } = await solve("astar", scenario);
    expect(result.outcome).toBe("no-solution");
  });
});

describe("時空間 A*（低レベル）", () => {
  it("予約されたセルを避けて待機する", () => {
    const map = createEmptyMap(3, 1);
    const table = new SimpleReservationTable();
    // 他エージェントが時刻 1 に (1,0) を占有する
    table.reserve("other", { x: 1, y: 0 }, 1);

    const out = spaceTimeAStar({
      map,
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 },
      agentId: "a1",
      rules: DEFAULT_RULES,
      reservations: table,
      reservationHorizon: 10,
      maxTime: 20,
      maxExpansions: 10_000,
    });

    expect(out.path).not.toBeNull();
    const at1 = out.path!.positions.find((p) => p.time === 1);
    expect(cellEquals(at1!.cell, { x: 1, y: 0 })).toBe(false);
  });

  it("入れ替わりを避ける", () => {
    const map = createEmptyMap(2, 1);
    const table = new SimpleReservationTable();
    table.reservePath(
      {
        agentId: "other",
        positions: [
          { time: 0, cell: { x: 1, y: 0 } },
          { time: 1, cell: { x: 0, y: 0 } },
        ],
      },
      5,
    );
    const out = spaceTimeAStar({
      map,
      start: { x: 0, y: 0 },
      goal: { x: 1, y: 0 },
      agentId: "a1",
      rules: DEFAULT_RULES,
      reservations: table,
      reservationHorizon: 5,
      maxTime: 10,
      maxExpansions: 10_000,
    });
    // (0,0)→(1,0) を時刻 1 で行うと入れ替わりになるので、そのままでは通れない
    if (out.path) {
      const at1 = out.path.positions.find((p) => p.time === 1);
      expect(cellEquals(at1!.cell, { x: 1, y: 0 })).toBe(false);
    }
  });

  it("展開上限を超えたら max-expansions で止まる", () => {
    const map = createEmptyMap(30, 30);
    const out = spaceTimeAStar({
      map,
      start: { x: 0, y: 0 },
      goal: { x: 29, y: 29 },
      agentId: "a1",
      rules: DEFAULT_RULES,
      maxTime: 500,
      maxExpansions: 5,
    });
    expect(out.path).toBeNull();
    expect(out.reason).toBe("max-expansions");
  });
});

describe("優先順位付き計画", () => {
  it("Swap Conflict を衝突なく解く", async () => {
    const scenario = buildPreset("swap-conflict", 1);
    const { result } = await solve("prioritized-planning", scenario);
    expect(result.outcome).toBe("solved");
    expect(result.conflicts).toHaveLength(0);
  });

  it("Narrow Corridor でも衝突が残らない", async () => {
    const scenario = buildPreset("narrow-corridor", 1);
    const { result } = await solve("prioritized-planning", scenario);
    if (result.outcome === "solved") {
      expect(result.conflicts).toHaveLength(0);
    } else {
      // 固定優先順位では解けない場合がある。手法の性質なので失敗も許容する。
      expect(["no-solution", "node-limit"]).toContain(result.outcome);
    }
  });

  it("優先順位のイベントを流す", async () => {
    const scenario = buildPreset("open-grid", 1);
    const { events } = await solve("prioritized-planning", scenario);
    expect(events.some((e) => e.type === "set-priority")).toBe(true);
    expect(events.some((e) => e.type === "reserve")).toBe(true);
    expect(events.some((e) => e.type === "finish")).toBe(true);
  });
});

describe("決定性", () => {
  it("同じ seed と同じ入力なら同じ結果になる", async () => {
    for (const solverId of ["astar", "prioritized-planning"]) {
      const scenario = buildPreset("random-obstacles", 42);
      const a = await solve(solverId, scenario);
      const b = await solve(solverId, scenario);
      expect(JSON.stringify(a.result.paths)).toBe(JSON.stringify(b.result.paths));
      expect(a.result.metrics.sumOfCosts).toBe(b.result.metrics.sumOfCosts);
    }
  });

  it("seed が違えばマップが変わる（random-obstacles）", () => {
    const a = buildPreset("random-obstacles", 1);
    const b = buildPreset("random-obstacles", 2);
    expect(JSON.stringify(a.map.blocked)).not.toBe(JSON.stringify(b.map.blocked));
  });
});

describe("中断", () => {
  it("AbortSignal が立っていれば aborted を返す", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runInline({
      solverId: "prioritized-planning",
      scenario: buildPreset("warehouse", 1),
      signal: controller.signal,
    });
    expect(result.outcome).toBe("aborted");
  });
});

describe("プリセット", () => {
  it("すべてのプリセットが妥当なシナリオを作る", () => {
    for (const preset of PRESETS) {
      const scenario = preset.build(3);
      expect(validateScenario(scenario), `${preset.id} が不正`).toEqual([]);
      for (const agent of scenario.agents) {
        expect(isWalkable(scenario.map, agent.start)).toBe(true);
        expect(isWalkable(scenario.map, agent.goal!)).toBe(true);
      }
    }
  });
});

describe("解が返ったときの整合性", () => {
  it("優先順位付き計画が solved を返したら衝突が無い", async () => {
    for (const preset of PRESETS) {
      const scenario = preset.build(5);
      const { result } = await solve("prioritized-planning", scenario);
      if (result.outcome !== "solved") continue;
      expect(detectConflicts(result.paths, scenario.rules), `${preset.id} で衝突`).toHaveLength(0);
    }
  });
});
