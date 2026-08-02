import { describe, expect, it } from "vitest";
import type { Scenario } from "@/lib/model/types";
import { DEFAULT_RULES, DEFAULT_SOLVER_OPTIONS } from "@/lib/model/types";
import { createEmptyMap, withBlocked } from "@/lib/model/grid";
import { PRESETS, buildPreset, scenarioFromJson, scenarioToJson } from "@/lib/model/scenario";
import { checkWellFormed, endpointsOf } from "@/lib/model/mapd";
import { createRecordingContext } from "@/solvers/context";
import { getSolver, solversFor } from "@/solvers/registry";
import { detectConflicts } from "@/lib/model/conflicts";
import { runMapdLoop, type MapdStepOutput, type MapdStrategy } from "@/solvers/mapd/loop";

const MAPD_PRESET_IDS = PRESETS.filter((p) => p.id.startsWith("mapd-")).map((p) => p.id);

async function run(scenario: Scenario, options = DEFAULT_SOLVER_OPTIONS) {
  const recording = createRecordingContext(scenario.seed);
  const result = await getSolver("mapd-greedy")!.solve(scenario, options, recording.context);
  return { result, events: recording.events };
}

/** 幅 1 の通路の上下に作業地点をぶら下げた、検査しやすい小さな盤面。 */
function corridor(): Scenario {
  let map = createEmptyMap(5, 3);
  for (const x of [0, 2, 4]) {
    map = withBlocked(map, { x, y: 0 }, true);
    map = withBlocked(map, { x, y: 2 }, true);
  }
  return {
    id: "c",
    name: "c",
    kind: "mapd",
    map,
    agents: [{ id: "a1", start: { x: 0, y: 1 } }],
    tasks: [{ id: "t1", pickup: { x: 1, y: 0 }, delivery: { x: 3, y: 2 }, releaseTime: 0 }],
    parkingEndpoints: [{ x: 0, y: 1 }],
    rules: DEFAULT_RULES,
    seed: 1,
  };
}

describe("MAPD の endpoint", () => {
  /*
    ★ mapd-tp-tpts-central-2017 p.2 §3.2:
      V_ep  = エージェント初期位置 ∪ 全タスクの pickup/delivery ∪ 追加 parking
      V_tsk = 全タスクの pickup/delivery
      non-task = V_ep \ V_tsk
  */
  it("V_ep / V_tsk / non-task を論文の定義どおりに分ける", () => {
    const scenario = corridor();
    const endpoints = endpointsOf(scenario);
    expect(endpoints.task.map((c) => `${c.x},${c.y}`).sort()).toEqual(["1,0", "3,2"]);
    // 初期位置 (0,1) は作業地点ではないので non-task 側。
    expect(endpoints.nonTask.map((c) => `${c.x},${c.y}`)).toEqual(["0,1"]);
    expect(endpoints.all).toHaveLength(3);
  });

  it("初期位置が作業地点と重なると non-task endpoint が減る", () => {
    const scenario: Scenario = {
      ...corridor(),
      agents: [{ id: "a1", start: { x: 1, y: 0 } }],
      parkingEndpoints: undefined,
    };
    expect(endpointsOf(scenario).nonTask).toHaveLength(0);
  });
});

describe("well-formed 判定（Definition 1）", () => {
  it("プリセットが満たす例と満たさない例を両方持つ", () => {
    expect(MAPD_PRESET_IDS.length).toBeGreaterThanOrEqual(2);
    const verdicts = MAPD_PRESET_IDS.map((id) => checkWellFormed(buildPreset(id, 1)).wellFormed);
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  it("条件 (b): non-task endpoint がエージェント数より少ないと落とす", () => {
    const scenario: Scenario = {
      ...corridor(),
      agents: [
        { id: "a1", start: { x: 0, y: 1 } },
        { id: "a2", start: { x: 1, y: 0 } },
      ],
      parkingEndpoints: [{ x: 0, y: 1 }],
    };
    const wf = checkWellFormed(scenario);
    expect(wf.wellFormed).toBe(false);
    expect(wf.violations.some((v) => v.includes("条件 (b)"))).toBe(true);
  });

  /*
    ★ 条件 (c) は「任意の 2 endpoint 間に、他の endpoint を通らない経路がある」。
      幅 1 の通路上に endpoint を 3 つ一列に置くと、両端を結ぶ経路が
      必ず真ん中を通るので落ちる。
  */
  it("条件 (c): 経路が必ず別の endpoint を通ると落とす", () => {
    const scenario: Scenario = {
      id: "line",
      name: "line",
      kind: "mapd",
      map: createEmptyMap(5, 1),
      agents: [{ id: "a1", start: { x: 0, y: 0 } }],
      tasks: [{ id: "t1", pickup: { x: 2, y: 0 }, delivery: { x: 4, y: 0 }, releaseTime: 0 }],
      rules: DEFAULT_RULES,
      seed: 1,
    };
    const wf = checkWellFormed(scenario);
    expect(wf.checked).toBe(true);
    expect(wf.wellFormed).toBe(false);
    expect(wf.violations.some((v) => v.includes("条件 (c)"))).toBe(true);
  });

  it("検査しきれなかったときは well-formed と名乗らない", () => {
    // endpoint 対が上限を超えるよう、作業地点を大量に作る。
    const tasks = Array.from({ length: 40 }, (_, i) => ({
      id: `t${i}`,
      pickup: { x: i % 20, y: 0 },
      delivery: { x: i % 20, y: 1 },
      releaseTime: 0,
    }));
    const wf = checkWellFormed({
      id: "big",
      name: "big",
      kind: "mapd",
      map: createEmptyMap(20, 4),
      agents: [{ id: "a1", start: { x: 0, y: 3 } }],
      tasks,
      rules: DEFAULT_RULES,
      seed: 1,
    });
    expect(wf.checked).toBe(false);
    expect(wf.wellFormed).toBe(false);
  });

  it("JSON へ書き出して読み戻しても判定が変わらない", () => {
    for (const id of MAPD_PRESET_IDS) {
      const scenario = buildPreset(id, 2);
      const restored = scenarioFromJson(JSON.parse(JSON.stringify(scenarioToJson(scenario))));
      expect(restored.kind).toBe("mapd");
      expect(checkWellFormed(restored).wellFormed).toBe(checkWellFormed(scenario).wellFormed);
    }
  });
});

describe("MAPD 実行ループ", () => {
  it("well-formed なプリセットを最後まで処理する", async () => {
    const scenario = buildPreset("mapd-well-formed", 1);
    const { result } = await run(scenario);
    expect(result.outcome).toBe("solved");
    expect(result.metrics.pendingTasks).toBe(0);
    expect(detectConflicts(result.paths, scenario.rules)).toEqual([]);
    expect(result.metrics.averageServiceTime).toBeGreaterThan(0);
    expect(result.metrics.throughput).toBeGreaterThan(0);
  });

  /*
    ★ service time は「task set に入ってから完了まで」（同 p.2 §3.1）。
      起点は releaseTime であって、割当時刻でも pickup 時刻でもない。
      release を遅らせた 2 つのインスタンスで、待ち時間ぶんだけ
      service time が変わらないことを固定する。
  */
  it("service time を releaseTime 起点で測る", async () => {
    const base = corridor();
    const { result: early } = await run(base);
    expect(early.outcome).toBe("solved");

    // 同じ経路長のまま release だけ 5 遅らせる。エージェントは 5 歩ぶん待つので、
    // 「割当からの時間」で測っていれば同じ値、releaseTime 起点なら同じ値になる。
    const delayed: Scenario = {
      ...base,
      tasks: [{ ...base.tasks![0]!, releaseTime: 5 }],
    };
    const { result: late } = await run(delayed);
    expect(late.outcome).toBe("solved");
    expect(late.metrics.averageServiceTime).toBe(early.metrics.averageServiceTime);
  });

  it("release-task / pickup / delivery を時系列で emit する", async () => {
    const { events } = await run(corridor());
    const kinds = events.map((e) => e.type);
    expect(kinds).toContain("release-task");
    expect(kinds).toContain("pickup");
    expect(kinds).toContain("delivery");
    const pickup = events.find((e) => e.type === "pickup") as { time: number };
    const delivery = events.find((e) => e.type === "delivery") as { time: number };
    expect(pickup.time).toBeLessThan(delivery.time);
  });

  /*
    ★ well-formed でない入力での失敗を、手法の欠陥と読ませない。
      同 p.4 Theorem 3 は well-formed な入力についての主張であり、
      同 p.2 は well-formed が十分条件であって必要条件ではないと述べている。
      どちらも警告に書いてあること。
  */
  it("well-formed でない入力には、保証の対象外だと警告する", async () => {
    const scenario = buildPreset("mapd-not-well-formed", 1);
    const { result } = await run(scenario);
    const messages = (result.warnings ?? []).map((w) => w.message).join("\n");
    expect(messages).toContain("well-formed ではありません");
    expect(messages).toContain("必要条件ではない");
    expect(messages).toContain("Theorem 3");
  });

  it("well-formed な入力には余計な警告を出さない", async () => {
    const { result } = await run(buildPreset("mapd-well-formed", 1));
    expect(result.warnings ?? []).toHaveLength(0);
  });

  it("タスクの無い MAPD と、MAPD 以外の Scenario を構造化して拒否する", async () => {
    const empty = await run({ ...corridor(), tasks: [] });
    expect(empty.result.outcome).toBe("error");
    expect(empty.result.error?.code).toBe("invalid-scenario");

    const oneShot = await run(buildPreset("open-grid", 1));
    expect(oneShot.result.outcome).toBe("error");
    expect(oneShot.result.error?.code).toBe("unsupported-rules");
  });

  it("同じ seed なら同じ結果を返す", async () => {
    const scenario = buildPreset("mapd-well-formed", 1);
    const first = await run(scenario);
    const second = await run(scenario);
    expect(first.result.paths).toEqual(second.result.paths);
    expect(first.result.metrics.averageServiceTime).toBe(second.result.metrics.averageServiceTime);
  });
});

/*
  ★ TPTS の「奪い取り」はループ側で条件を強制する。
    mapd-tp-tpts-central-2017 p.4 §4.2 は、まだ pickup へ向かっている途中の
    タスクだけを奪えると定めている。判定を戦略ごとに書くと条件を
    取りこぼすので、ループ 1 箇所に置いてある。
*/
describe("割当の奪い取りと解除（ループ側の強制）", () => {
  /** 指定どおりに割当だけ動かし、移動はしない検査用の戦略。 */
  function scriptedStrategy(script: Record<number, Partial<MapdStepOutput>>): MapdStrategy {
    return {
      name: "scripted",
      step: (input) => ({ moves: new Map(), ...(script[input.time] ?? {}) }),
    };
  }

  async function runScripted(script: Record<number, Partial<MapdStepOutput>>) {
    const scenario = corridor();
    const recording = createRecordingContext(scenario.seed);
    const result = await runMapdLoop(
      scenario,
      { ...DEFAULT_SOLVER_OPTIONS, horizon: 6 },
      recording.context,
      scriptedStrategy(script),
    );
    return { result, events: recording.events };
  }

  it("pickup 前のタスクは他のエージェントへ移せる", async () => {
    const { events } = await runScripted({
      0: { assign: new Map([["a1", "t1"]]) },
      1: { assign: new Map([["a2", "t1"]]) },
    });
    const swap = events.find((e) => e.type === "swap-task") as
      { taskId: string; from: string; to: string } | undefined;
    expect(swap).toBeDefined();
    expect(swap!.taskId).toBe("t1");
    expect(swap!.from).toBe("a1");
    expect(swap!.to).toBe("a2");
  });

  it("pickup 済みのタスクは奪えない", async () => {
    // a1 は (0,1) から (1,0) の pickup へ 2 歩。到達させてから奪いにいく。
    const toPickup = new Map([["a1", { x: 1, y: 1 }]]);
    const ontoPickup = new Map([["a1", { x: 1, y: 0 }]]);
    const { events } = await runScripted({
      0: { assign: new Map([["a1", "t1"]]), moves: toPickup },
      1: { moves: ontoPickup },
      2: { assign: new Map([["a2", "t1"]]) },
      3: { assign: new Map([["a2", "t1"]]) },
    });
    expect(events.some((e) => e.type === "pickup")).toBe(true);
    expect(events.some((e) => e.type === "swap-task")).toBe(false);
  });

  it("pickup 済みのタスクは解除もできない", async () => {
    const { result } = await runScripted({
      0: { assign: new Map([["a1", "t1"]]), moves: new Map([["a1", { x: 1, y: 1 }]]) },
      1: { moves: new Map([["a1", { x: 1, y: 0 }]]) },
      2: { unassign: ["a1"] },
      3: { moves: new Map([["a1", { x: 1, y: 1 }]]) },
      4: { moves: new Map([["a1", { x: 2, y: 1 }]]) },
      5: { moves: new Map([["a1", { x: 3, y: 1 }]]) },
    });
    // 解除できていれば運搬が消えて delivery に届かない。届いていれば保持されている。
    expect(result.metrics.pendingTasks).toBe(1);
  });

  it("pickup 前なら解除できて、そのタスクは未割当へ戻る", async () => {
    const { events } = await runScripted({
      0: { assign: new Map([["a1", "t1"]]) },
      1: { unassign: ["a1"] },
      2: { assign: new Map([["a2", "t1"]]) },
    });
    // 解除を挟んだので奪い取りではなく、通常の割当になる。
    expect(events.some((e) => e.type === "swap-task")).toBe(false);
  });
});

describe("MAPD の Solver 絞り込み", () => {
  it("MAPD では MAPD 用の手法だけが選べる", () => {
    const scenario = buildPreset("mapd-well-formed", 1);
    const ids = solversFor(scenario.kind, scenario).map((s) => s.metadata.id);
    expect(ids).toContain("mapd-greedy");
    expect(ids).not.toContain("cbs");
    expect(ids).not.toContain("rhcr");
  });

  it("MAPD 用の手法は他の kind に出ない", () => {
    for (const id of ["open-grid", "tapf-crossing"]) {
      const scenario = buildPreset(id, 1);
      const ids = solversFor(scenario.kind, scenario).map((s) => s.metadata.id);
      expect(ids).not.toContain("mapd-greedy");
    }
  });
});
