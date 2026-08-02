import { describe, expect, it } from "vitest";
import { createEmptyMap, withBlocked } from "@/lib/model/grid";
import { DEFAULT_RULES, DEFAULT_SOLVER_OPTIONS, type Scenario } from "@/lib/model/types";
import { PRESETS, buildPreset } from "@/lib/model/scenario";
import { createRecordingContext } from "@/solvers/context";
import { getSolver } from "@/solvers/registry";
import { mlaStar } from "@/solvers/mapd/mla-star";
import { runMapdLoop } from "@/solvers/mapd/loop";
import { createHbhStrategy } from "@/solvers/mapd/strategies";

async function run(id: string, scenario: Scenario) {
  const recording = createRecordingContext(scenario.seed);
  const solver = getSolver(id);
  if (!solver) throw new Error(`missing solver ${id}`);
  const result = await solver.solve(scenario, DEFAULT_SOLVER_OPTIONS, recording.context);
  return { result, events: recording.events };
}

describe("Batch 8 MAPD strategies", () => {
  it("全 MAPD プリセット × 全 MAPD 手法は、solved なら衝突を残さない", async () => {
    const presetIds = PRESETS.filter((preset) => preset.id.startsWith("mapd-")).map(
      (preset) => preset.id,
    );
    for (const presetId of presetIds) {
      for (const solverId of ["mapd-greedy", "token-passing", "tpts", "central"]) {
        const { result } = await run(solverId, buildPreset(presetId, 1));
        if (result.outcome === "solved")
          expect(result.conflicts, `${presetId}/${solverId}`).toEqual([]);
      }
    }
  });
  it.each(["token-passing", "tpts", "central"])(
    "%s は well-formed preset を完了する",
    async (id) => {
      const scenario = buildPreset("mapd-well-formed", 1);
      const { result, events } = await run(id, scenario);
      expect(result.outcome).toBe("solved");
      expect(result.metrics.pendingTasks).toBe(0);
      expect(result.conflicts).toEqual([]);
      expect(result.metrics.averageServiceTime).toBeGreaterThan(0);
      expect(result.metrics.throughput).toBeGreaterThan(0);
      expect(events.some((event) => event.type === "update-token")).toBe(true);
      expect(events.some((event) => event.type === "assign-task")).toBe(true);
    },
  );

  it("TP/TPTS は非 well-formed 入力で loop の保証対象外警告を重複させない", async () => {
    const scenario = buildPreset("mapd-not-well-formed", 1);
    for (const id of ["token-passing", "tpts"]) {
      const { result } = await run(id, scenario);
      const warnings = (result.warnings ?? []).filter((warning) =>
        warning.message.includes("well-formed ではありません"),
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.message).toContain("Theorem 3");
    }
  });

  it("TPTS は同一 timestep の未確定 assignment を交換する", async () => {
    const scenario: Scenario = {
      id: "same-step-swap",
      name: "same-step-swap",
      kind: "mapd",
      map: createEmptyMap(6, 3),
      agents: [
        { id: "a1", start: { x: 0, y: 1 } },
        { id: "a2", start: { x: 5, y: 1 } },
      ],
      tasks: [{ id: "t1", pickup: { x: 5, y: 0 }, delivery: { x: 5, y: 2 }, releaseTime: 0 }],
      parkingEndpoints: [
        { x: 0, y: 1 },
        { x: 5, y: 1 },
      ],
      rules: DEFAULT_RULES,
      seed: 1,
    };
    const { result, events } = await run("tpts", scenario);
    expect(result.outcome).toBe("solved");
    // 同一 timestep の暫定割当は loop の carrying 前なので swap-task にはならない。
    // 実際の timestep をまたぐ奪い取りは mapd-task-swap で検証する。
    expect(events.some((event) => event.type === "assign-task" && event.agentId === "a2")).toBe(
      true,
    );
    expect(
      events.filter((event) => event.type === "delivery" && event.taskId === "t1"),
    ).toHaveLength(1);
  });

  it("mapd-task-swap では TPTS が前 timestep の未 pickup task を奪う", async () => {
    const scenario = buildPreset("mapd-task-swap", 1);
    const tp = await run("token-passing", scenario);
    const tpts = await run("tpts", scenario);
    expect(tp.result.outcome).toBe("solved");
    expect(tpts.result.outcome).toBe("solved");
    expect(tp.result.conflicts).toEqual([]);
    expect(tpts.result.conflicts).toEqual([]);
    expect(tpts.result.metrics.makespan).not.toBe(tp.result.metrics.makespan);
    expect(
      tpts.events.some(
        (event) =>
          event.type === "swap-task" &&
          event.taskId === "t1" &&
          event.from === "a1" &&
          event.to === "a2",
      ),
    ).toBe(true);
  });

  it("mapd-parking では TP の Path2 が greedy と異なる経路を選ぶ", async () => {
    const scenario = buildPreset("mapd-parking", 1);
    const greedy = await run("mapd-greedy", scenario);
    const tp = await run("token-passing", scenario);
    expect(greedy.result.outcome).toBe("solved");
    expect(tp.result.outcome).toBe("solved");
    expect(greedy.result.conflicts).toEqual([]);
    expect(tp.result.conflicts).toEqual([]);
    expect(tp.result.metrics.makespan).toBeLessThan(greedy.result.metrics.makespan);
    expect(tp.result.paths).not.toEqual(greedy.result.paths);
  });

  /*
    ★ TP / CENTRAL が「解が求まりました」なのに衝突を残していた回帰。
      原因は、token に入っている resting path（配達を終えた agent が
      その場に留まり続ける尾部）を、MLA* が将来時刻まで見ていなかったこと。
      論文 p.3 の Path1 は「does not collide with the paths of other agents
      stored in the token」を満たす経路を返す契約なので、尾部も含めて
      避けられなければ契約違反になる。

    ★ プリセットに依存させない。ここは「resting tail を見ているか」だけを
      調べる検査で、盤面の座標が変わると意味が変わってしまう。
      実際、プリセットを差し替えたときに pickup が壁の上に来てしまい、
      resting tail と無関係な理由で null になって通り続けていた。
      同じ盤面を 2 通り（占有あり / 占有なし）で回し、差が出ることを見る。
  */
  it("MLA* は token の resting tail が pickup を永久占有することを検出する", () => {
    // 幅 1 の通路。pickup (3,0) と delivery (1,2) は alcove。
    let map = createEmptyMap(5, 3);
    for (const x of [0, 2, 4]) {
      map = withBlocked(map, { x, y: 0 }, true);
      map = withBlocked(map, { x, y: 2 }, true);
    }
    const scenario: Scenario = {
      id: "tail",
      name: "tail",
      kind: "mapd",
      map,
      agents: [{ id: "a1", start: { x: 0, y: 1 } }],
      tasks: [{ id: "t1", pickup: { x: 3, y: 0 }, delivery: { x: 1, y: 2 }, releaseTime: 0 }],
      rules: DEFAULT_RULES,
      seed: 1,
    };
    const call = (token: Parameters<typeof mlaStar>[0]["token"]) =>
      mlaStar({
        scenario,
        agentId: "a1",
        start: { x: 0, y: 1 },
        startTime: 0,
        pickup: { x: 3, y: 0 },
        delivery: { x: 1, y: 2 },
        token,
        maxTime: 40,
        maxExpansions: 100_000,
      });

    // 何も居なければ通れる。座標が妥当であることの確認も兼ねる。
    expect(call(new Map()).path).not.toBeNull();

    // a2 が pickup へ入って以後ずっと居座る。尾部を見ていれば経路は作れない。
    const occupied = call(
      new Map([
        [
          "a2",
          {
            agentId: "a2",
            positions: [
              { time: 0, cell: { x: 3, y: 1 } },
              { time: 1, cell: { x: 3, y: 0 } },
            ],
          },
        ],
      ]),
    );
    expect(occupied.path).toBeNull();
  });

  it("MLA* は pickup 後 label で delivery に到達する", () => {
    const scenario = buildPreset("mapd-well-formed", 1);
    const agent = scenario.agents[0]!;
    const task = scenario.tasks![0]!;
    const output = mlaStar({
      scenario,
      agentId: agent.id,
      start: agent.start,
      startTime: 0,
      pickup: task.pickup,
      delivery: task.delivery,
      token: new Map(),
      maxTime: 100,
      maxExpansions: 100_000,
    });
    expect(output.path).not.toBeNull();
    expect(output.path?.positions.at(-1)?.cell).toEqual(task.delivery);
    expect(output.expanded).toBeGreaterThan(0);
  });

  it("HBH は Hungarian + MLA* の内部 strategy として動く", async () => {
    const scenario = buildPreset("mapd-well-formed", 1);
    const recording = createRecordingContext(scenario.seed);
    const result = await runMapdLoop(
      scenario,
      DEFAULT_SOLVER_OPTIONS,
      recording.context,
      createHbhStrategy(DEFAULT_SOLVER_OPTIONS, recording.context),
    );
    expect(result.outcome).toBe("solved");
    expect(result.metrics.pendingTasks).toBe(0);
  });
});
