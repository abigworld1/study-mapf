import { describe, expect, it } from "vitest";
import type { Scenario } from "@/lib/model/types";
import { DEFAULT_RULES, DEFAULT_SOLVER_OPTIONS } from "@/lib/model/types";
import { createEmptyMap } from "@/lib/model/grid";
import {
  PRESETS,
  buildPreset,
  scenarioFromJson,
  scenarioToJson,
  validateScenario,
} from "@/lib/model/scenario";
import { createRecordingContext } from "@/solvers/context";
import { getSolver, listSolverMetadata, solversFor } from "@/solvers/registry";
import { checkPaths } from "../helpers/check-paths";

const TAPF_PRESET_IDS = PRESETS.filter((p) => p.id.startsWith("tapf-")).map((p) => p.id);

function twoAgentTeam(goals: readonly { x: number; y: number }[]): Scenario {
  return {
    id: "t",
    name: "t",
    kind: "tapf",
    map: createEmptyMap(5, 3),
    agents: [
      { id: "a1", start: { x: 0, y: 0 } },
      { id: "a2", start: { x: 0, y: 2 } },
    ],
    teams: [{ id: "team1", agentIds: ["a1", "a2"], goals: [...goals] }],
    rules: DEFAULT_RULES,
    seed: 1,
  };
}

async function solveTapf(scenario: Scenario, options = DEFAULT_SOLVER_OPTIONS) {
  const recording = createRecordingContext(scenario.seed);
  const result = await getSolver("tapf-baseline")!.solve(scenario, options, recording.context);
  return { result, events: recording.events };
}

describe("TAPF のモデル", () => {
  it("プリセットは検証を通り、チームごとに target 数とエージェント数が一致する", () => {
    expect(TAPF_PRESET_IDS.length).toBeGreaterThan(0);
    for (const id of TAPF_PRESET_IDS) {
      const scenario = buildPreset(id, 1);
      expect(scenario.kind).toBe("tapf");
      expect(validateScenario(scenario)).toEqual([]);
      for (const team of scenario.teams ?? []) {
        expect(team.goals.length).toBe(team.agentIds.length);
      }
    }
  });

  /*
    ★ 「チームの target 数 = チームのエージェント数」は
      cbm-tapf-aamas-2016 p.2 §2.1 の定義そのもので、こちらの都合ではない。
      崩れると「各 target がちょうど 1 体に訪問される」が成立せず、
      最適性の議論の前提が消える。だから検証で必ず弾く。
  */
  it("target 数がエージェント数と違うチームを拒否する", () => {
    const problems = validateScenario(twoAgentTeam([{ x: 4, y: 0 }]));
    expect(problems.some((p) => p.includes("target が 1 個"))).toBe(true);
  });

  it("target の重複と、どのチームにも属さないエージェントを拒否する", () => {
    const duplicated = validateScenario(
      twoAgentTeam([
        { x: 4, y: 0 },
        { x: 4, y: 0 },
      ]),
    );
    expect(duplicated.some((p) => p.includes("重複"))).toBe(true);

    const orphan: Scenario = {
      ...twoAgentTeam([
        { x: 4, y: 0 },
        { x: 4, y: 2 },
      ]),
      agents: [
        { id: "a1", start: { x: 0, y: 0 } },
        { id: "a2", start: { x: 0, y: 2 } },
        { id: "a3", start: { x: 1, y: 1 } },
      ],
    };
    expect(validateScenario(orphan).some((p) => p.includes("どのチームにも属さない"))).toBe(true);
  });

  it("JSON へ書き出して読み戻すとチームが保たれる", () => {
    for (const id of TAPF_PRESET_IDS) {
      const scenario = buildPreset(id, 3);
      const restored = scenarioFromJson(JSON.parse(JSON.stringify(scenarioToJson(scenario))));
      expect(restored.kind).toBe("tapf");
      expect(restored.teams).toEqual(scenario.teams);
      expect(validateScenario(restored)).toEqual([]);
    }
  });
});

describe("Scenario.kind による Solver の絞り込み", () => {
  /*
    ★ metadata.supports は前からあったのに UI が使っておらず、
      RHCR（lifelong 専用）が one-shot でも選べて必ずエラーになる状態が
      一度できていた。kind ごとに「選べる手法は全部その kind に対応している」
      ことを固定して、TAPF / MAPD で同じことを繰り返さないようにする。
  */
  it("どの kind でも、絞り込んだ手法は全てその kind に対応している", () => {
    for (const kind of ["one-shot-mapf", "lifelong-mapf", "mapd", "tapf"] as const) {
      for (const solver of solversFor(kind)) {
        expect(solver.metadata.supports).toContain(kind);
      }
    }
  });

  it("TAPF に対応した実装が 1 つ以上あり、one-shot 専用の手法は含まれない", () => {
    const tapfSolvers = solversFor("tapf");
    expect(tapfSolvers.length).toBeGreaterThan(0);
    expect(tapfSolvers.some((s) => s.metadata.id === "tapf-baseline")).toBe(true);
    expect(tapfSolvers.some((s) => s.metadata.id === "cbs")).toBe(false);
  });

  it("登録済みの全手法が supports を 1 つ以上宣言している", () => {
    for (const metadata of listSolverMetadata()) {
      expect(metadata.supports.length).toBeGreaterThan(0);
    }
  });
});

describe("全探索割当 + CBS", () => {
  it("TAPF プリセットを解き、割当と目的関数を返す", async () => {
    for (const id of TAPF_PRESET_IDS) {
      const scenario = buildPreset(id, 1);
      const { result } = await solveTapf(scenario);
      expect(result.outcome).toBe("solved");
      expect(checkPaths({ ...scenario, kind: "one-shot-mapf" }, result.paths)).toEqual([]);
      expect(result.conflicts).toEqual([]);
      expect(result.objective).toBe("makespan");
      expect(result.targetAssignments).toHaveLength(scenario.agents.length);
    }
  });

  /*
    ★ 割当が解の一部であることを、実際に動く形で固定する。
      tapf-crossing はチームの並び順どおりに割り当てると経路が交差して
      makespan 10 になるが、入れ替えれば 6 で済む。
      並び順をそのまま使う実装に退化したらここで落ちる。
  */
  it("並び順ではなく最適な割当を選ぶ", async () => {
    const scenario = buildPreset("tapf-crossing", 1);
    const { result } = await solveTapf(scenario);
    expect(result.metrics.makespan).toBe(6);

    const team = scenario.teams![0]!;
    const chosen = new Map(result.targetAssignments!.map((a) => [a.agentId, a.goal]));
    // 並び順は a1→goals[0]。最適はその逆。
    expect(chosen.get("a1")).toEqual(team.goals[1]);
    expect(chosen.get("a2")).toEqual(team.goals[0]);
  });

  it("各エージェントが自分のチームの target をちょうど 1 つずつ取る", async () => {
    const scenario = buildPreset("tapf-two-teams", 1);
    const { result } = await solveTapf(scenario);
    for (const team of scenario.teams ?? []) {
      const mine = result.targetAssignments!.filter((a) => a.teamId === team.id);
      expect(mine.map((a) => a.agentId).sort()).toEqual([...team.agentIds].sort());
      const goalKeys = mine.map((a) => `${a.goal.x},${a.goal.y}`).sort();
      expect(goalKeys).toEqual(team.goals.map((g) => `${g.x},${g.y}`).sort());
    }
  });

  /*
    ★ makespan 最適であって sum of costs 最適ではない。
      CBM は makespan（cbm-tapf-aamas-2016 p.2）、CBS-TA は sum of costs
      （cbs-ta-aamas-2018 p.2）を最小化する。画面は両方の数値を出すので、
      どちらを最適化したのかを言わないと過大主張になる。
  */
  it("目的関数と、全探索であることを警告で明示する", async () => {
    const { result } = await solveTapf(buildPreset("tapf-two-teams", 1));
    const messages = (result.warnings ?? []).map((w) => w.message).join("\n");
    expect(messages).toContain("最小化したのは makespan");
    expect(messages).toContain("sum of costs は最適値ではありません");
    expect(messages).toContain("全て試して");
  });

  it("同じ seed なら同じ割当と経路を返す", async () => {
    const scenario = buildPreset("tapf-two-teams", 1);
    const first = await solveTapf(scenario);
    const second = await solveTapf(scenario);
    expect(first.result.targetAssignments).toEqual(second.result.targetAssignments);
    expect(first.result.paths).toEqual(second.result.paths);
  });

  it("TAPF 以外の Scenario と、組合せが多すぎる入力を構造化して拒否する", async () => {
    const oneShot = await solveTapf(buildPreset("open-grid", 1));
    expect(oneShot.result.outcome).toBe("error");
    expect(oneShot.result.error?.code).toBe("unsupported-rules");

    // 8 体 1 チーム = 40320 通りで上限を超える。
    const big: Scenario = {
      id: "big",
      name: "big",
      kind: "tapf",
      map: createEmptyMap(10, 10),
      agents: Array.from({ length: 8 }, (_, i) => ({ id: `a${i + 1}`, start: { x: 0, y: i } })),
      teams: [
        {
          id: "team1",
          agentIds: Array.from({ length: 8 }, (_, i) => `a${i + 1}`),
          goals: Array.from({ length: 8 }, (_, i) => ({ x: 9, y: i })),
        },
      ],
      rules: DEFAULT_RULES,
      seed: 1,
    };
    const tooBig = await solveTapf(big);
    expect(tooBig.result.outcome).toBe("error");
    expect(tooBig.result.error?.message).toContain("40320");
  });
});
