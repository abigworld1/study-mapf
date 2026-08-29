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

  /*
    RunSolverInput が options を宣言しているのに runInline がそれを読まず、
    `runInline({ solverId, scenario, options })` が黙ってデフォルトで走っていた。
    テストが無かったので誰も気付かなかった。
  */
  it("runInline が input.options を反映する", async () => {
    const scenario = buildPreset("warehouse", 1);
    const result = await runInline({
      solverId: "prioritized-planning",
      scenario,
      options: { ...DEFAULT_SOLVER_OPTIONS, maxExpansions: 1 },
    });
    expect(result.outcome, "maxExpansions: 1 が無視されている").toBe("node-limit");
  });
});

describe("解けなかった理由の説明責任", () => {
  /*
    ★ 不完全な手法が「解が見つからなかった」を返すとき、
      それが解の非存在の証明でないことを warnings で言わねばならない。
      表示側（Simulator）も warnings を必ず描画する。
  */
  it("PBS は優先度木を枯渇させたとき、非存在の証明ではないと明示する", async () => {
    // 幅 5 の通路に待避ポケットが 1 つ。CBS は sum of costs 11 で解けるが、
    // どちらの全順序でも高優先度側が最短経路を占有するため PBS は枯渇する。
    let map = createEmptyMap(5, 2);
    for (const cell of [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 1 },
    ]) {
      map = withBlocked(map, cell, true);
    }
    const scenario: Scenario = {
      id: "pocket",
      name: "pocket",
      kind: "one-shot-mapf",
      map,
      agents: [
        { id: "a1", start: { x: 0, y: 0 }, goal: { x: 4, y: 0 } },
        { id: "a2", start: { x: 4, y: 0 }, goal: { x: 0, y: 0 } },
      ],
      rules: DEFAULT_RULES,
      seed: 1,
    };

    const cbs = await solve("cbs", scenario);
    expect(cbs.result.outcome, "前提が崩れている。この問題は解ける必要がある").toBe("solved");

    const { result } = await solve("pbs", scenario);
    expect(result.outcome).toBe("no-solution");
    expect(result.warnings ?? [], "PBS が但し書き無しで no-solution を返している").not.toHaveLength(
      0,
    );
  });

  it("PIBT / winPIBT も打切り時に但し書きを返す", async () => {
    for (const solverId of ["pibt", "winpibt"]) {
      const solver = getSolver(solverId)!;
      const { context } = createRecordingContext(1);
      const result = await solver.solve(
        buildPreset("narrow-corridor", 1),
        { ...DEFAULT_SOLVER_OPTIONS, extra: { maxTimesteps: 4 } },
        context,
      );
      if (result.outcome === "solved") continue;
      expect(result.warnings ?? [], `${solverId} が但し書き無しで打ち切った`).not.toHaveLength(0);
    }
  });

  /*
    ★ LaCAM* の最適性は OPEN を空にしたときの主張。
      打ち切って途中経過の解を返すとき、シミュレータはその経路を再生するので、
      最適でないことを言わないと表示された解が最適と受け取られる。
      SOURCE_POLICY.md 第 8 条がこの手法を名指ししている。
  */
  it("LaCAM* は打ち切って解を返すとき、最適解でないと明示する", async () => {
    let map = createEmptyMap(5, 2);
    for (const cell of [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 1 },
    ]) {
      map = withBlocked(map, cell, true);
    }
    const scenario: Scenario = {
      id: "pocket",
      name: "pocket",
      kind: "one-shot-mapf",
      map,
      agents: [
        { id: "a1", start: { x: 0, y: 0 }, goal: { x: 4, y: 0 } },
        { id: "a2", start: { x: 4, y: 0 }, goal: { x: 0, y: 0 } },
      ],
      rules: DEFAULT_RULES,
      seed: 1,
    };
    const solver = getSolver("lacam-star")!;

    const cut = await solver.solve(
      scenario,
      { ...DEFAULT_SOLVER_OPTIONS, maxExpansions: 30 },
      createRecordingContext(1).context,
    );
    /*
      ★ 打ち切っても解は解なので outcome は solved。
        「完遂していない」は warnings で言う。ここを outcome に混ぜていたため、
        有効な解を返しながら画面に「上限到達」と出していた。
    */
    expect(cut.outcome, "有効な解を返すなら solved").toBe("solved");
    expect(cut.failureReason, "solved に failureReason は付けない").toBeUndefined();
    expect(cut.paths.length, "途中経過の解が返る想定").toBeGreaterThan(0);
    expect(
      (cut.warnings ?? []).some((w) => w.message.includes("最適解ではありません")),
      "打ち切った解を最適でないと言っていない",
    ).toBe(true);
    expect(
      (cut.warnings ?? []).some((w) => w.message.includes("展開数の上限")),
      "なぜ打ち切ったのかを言っていない",
    ).toBe(true);

    // 完遂した場合は逆に、その但し書きを出してはいけない。
    const full = await solver.solve(
      scenario,
      { ...DEFAULT_SOLVER_OPTIONS, maxExpansions: 2_000_000 },
      createRecordingContext(1).context,
    );
    expect(full.outcome).toBe("solved");
    expect((full.warnings ?? []).some((w) => w.message.includes("最適解ではありません"))).toBe(
      false,
    );
  });

  /*
    ★ sum-of-loss と sum of costs の食い違いは、実際に食い違ったときだけ言う。
      毎回出していると、上の「最適ではない」が埋もれる。
  */
  it("LaCAM* は目的関数が一致する解では sum-of-loss の但し書きを出さない", async () => {
    const solver = getSolver("lacam-star")!;
    const result = await solver.solve(
      buildPreset("open-grid", 1),
      { ...DEFAULT_SOLVER_OPTIONS, maxExpansions: 2_000_000 },
      createRecordingContext(1).context,
    );
    expect(result.outcome).toBe("solved");
    // このプリセットの解では goal を離れる agent がいないので sum-of-loss と
    // sum of costs は一致する。一致しているのに但し書きを出すと、
    // 上の「最適ではない」が埋もれる。
    expect(
      (result.warnings ?? []).filter((w) => w.message.includes("sum-of-loss")),
      "目的関数が一致しているのに但し書きが出ている",
    ).toHaveLength(0);
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
        expect(isWalkable(scenario.map, agent.start), `${preset.id}/${agent.id} の start`).toBe(
          true,
        );
      }
      /*
        ★ 「どこへ行くのか」の在り処は kind で変わる。

          TAPF ではエージェントに固定 goal が無く、target はチームが持つ
          （cbm-tapf-aamas-2016 p.2）。MAPD にも固定 goal は無く、
          行き先はタスクの pickup / delivery として後から現れる
          （mapd-tp-tpts-central-2017 p.2 §3.1）。
          どちらも agent.goal を要求すると「もう決まっている」を前提にしてしまう。
      */
      if (scenario.kind === "tapf") {
        for (const team of scenario.teams ?? []) {
          for (const goal of team.goals) {
            expect(isWalkable(scenario.map, goal), `${preset.id}/${team.id} の target`).toBe(true);
          }
        }
      } else if (scenario.kind === "mapd") {
        expect(scenario.tasks?.length ?? 0, `${preset.id} のタスク`).toBeGreaterThan(0);
        for (const task of scenario.tasks ?? []) {
          expect(isWalkable(scenario.map, task.pickup), `${preset.id}/${task.id} の pickup`).toBe(
            true,
          );
          expect(
            isWalkable(scenario.map, task.delivery),
            `${preset.id}/${task.id} の delivery`,
          ).toBe(true);
        }
      } else {
        for (const agent of scenario.agents) {
          expect(isWalkable(scenario.map, agent.goal!), `${preset.id}/${agent.id} の goal`).toBe(
            true,
          );
        }
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
