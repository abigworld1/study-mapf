import { describe, expect, it } from "vitest";
import type { Scenario, SolverOptions, SolverResult } from "@/lib/model/types";
import { DEFAULT_RULES, DEFAULT_SOLVER_OPTIONS } from "@/lib/model/types";
import { createEmptyMap, withBlocked } from "@/lib/model/grid";
import { createRecordingContext } from "@/solvers/context";
import { getSolver } from "@/solvers/registry";
import { checkPaths } from "../helpers/check-paths";

type SolverId = "mapf-lns" | "mapf-lns2" | "rhcr";

function oneShotSwap(): Scenario {
  return {
    id: "batch6-swap",
    name: "Batch 6 swap",
    kind: "one-shot-mapf",
    map: createEmptyMap(3, 2),
    agents: [
      { id: "a1", start: { x: 0, y: 0 }, goal: { x: 2, y: 0 } },
      { id: "a2", start: { x: 2, y: 0 }, goal: { x: 0, y: 0 } },
    ],
    rules: DEFAULT_RULES,
    seed: 7,
  };
}

function lifelongScenario(): Scenario {
  return {
    id: "batch6-lifelong",
    name: "Batch 6 lifelong",
    kind: "lifelong-mapf",
    map: createEmptyMap(4, 2),
    agents: [
      { id: "a1", start: { x: 0, y: 0 }, goal: { x: 3, y: 0 } },
      { id: "a2", start: { x: 0, y: 1 }, goal: { x: 3, y: 1 } },
    ],
    rules: DEFAULT_RULES,
    seed: 8,
  };
}

function longLifelongScenario(): Scenario {
  return {
    id: "batch6-long-lifelong",
    name: "Batch 6 long lifelong",
    kind: "lifelong-mapf",
    map: createEmptyMap(12, 2),
    agents: [{ id: "a1", start: { x: 0, y: 0 }, goal: { x: 11, y: 0 } }],
    rules: DEFAULT_RULES,
    seed: 9,
  };
}

function priorityDeadEndSwap(): Scenario {
  let map = createEmptyMap(5, 3);
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 5; x += 1) map = withBlocked(map, { x, y }, true);
  }
  for (const x of [0, 1, 2, 3, 4]) map = withBlocked(map, { x, y: 1 }, false);
  map = withBlocked(map, { x: 2, y: 2 }, false);
  return {
    id: "batch6-priority-dead-end",
    name: "Batch 6 priority dead end",
    kind: "one-shot-mapf",
    map,
    agents: [
      { id: "a1", start: { x: 0, y: 1 }, goal: { x: 4, y: 1 } },
      { id: "a2", start: { x: 4, y: 1 }, goal: { x: 0, y: 1 } },
    ],
    rules: DEFAULT_RULES,
    seed: 10,
  };
}

async function solve(
  id: SolverId,
  scenario: Scenario,
  options: SolverOptions = DEFAULT_SOLVER_OPTIONS,
) {
  const solver = getSolver(id);
  expect(solver).toBeDefined();
  const recording = createRecordingContext(scenario.seed);
  const result = await solver!.solve(scenario, options, recording.context);
  return { result, events: recording.events };
}

function expectValid(scenario: Scenario, result: SolverResult): void {
  expect(result.outcome).toBe("solved");
  expect(checkPaths(scenario, result.paths)).toEqual([]);
  expect(result.conflicts).toEqual([]);
}

describe("Batch 6 registry", () => {
  it("MAPF-LNS / MAPF-LNS2 / RHCR を runnable として登録する", () => {
    expect(getSolver("mapf-lns")?.metadata.status).toBe("runnable");
    expect(getSolver("mapf-lns2")?.metadata.status).toBe("runnable");
    expect(getSolver("rhcr")?.metadata.status).toBe("runnable");
  });
});

describe("MAPF-LNS", () => {
  it("初期解から近傍 repair を行い collision-free path を返す", async () => {
    const { result, events } = await solve("mapf-lns", oneShotSwap(), {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { iterations: 8, neighborhoodSize: 2 },
      traceLevel: "detailed",
    });
    expectValid(oneShotSwap(), result);
    expect(events.some((event) => event.type === "select-neighborhood")).toBe(true);
    expect(events.some((event) => event.type === "repair-neighborhood")).toBe(true);
    expect(result.metrics.replans).toBeGreaterThan(0);
  });
});

describe("MAPF-LNS2", () => {
  it("衝突を含む個別最短 path を CP 修復で解消する", async () => {
    const scenario = oneShotSwap();
    const { result, events } = await solve("mapf-lns2", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { iterations: 40, neighborhoodSize: 2, neighborhoodStrategy: "agent" },
      traceLevel: "detailed",
    });
    expectValid(scenario, result);
    expect(events.some((event) => event.type === "update-incumbent")).toBe(true);
    expect(result.metrics.conflictsDetected).toBeDefined();
  });

  it("同じ seed なら deterministic", async () => {
    const scenario = oneShotSwap();
    const first = await solve("mapf-lns2", scenario);
    const second = await solve("mapf-lns2", scenario);
    expect(first.result.outcome).toBe(second.result.outcome);
    expect(first.result.paths).toEqual(second.result.paths);
  });

  it("不完全な初期／修復失敗は解なしの証明ではないと警告する", async () => {
    for (const id of ["mapf-lns", "mapf-lns2"] as const) {
      const { result } = await solve(id, priorityDeadEndSwap(), {
        ...DEFAULT_SOLVER_OPTIONS,
        extra: { iterations: 1, neighborhoodSize: 2, neighborhoodStrategy: "agent" },
      });
      expect(result.outcome).not.toBe("solved");
      expect(
        result.warnings?.some((warning) =>
          warning.message.includes("解の非存在の証明ではありません"),
        ),
      ).toBe(true);
    }
  });
});

describe("RHCR", () => {
  it("w と h を分けて lifelong episode を再計画する", async () => {
    const scenario = lifelongScenario();
    const { result, events } = await solve("rhcr", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      horizon: 8,
      extra: { planningWindow: 4, replanningPeriod: 2 },
      traceLevel: "detailed",
    });
    expectValid(scenario, result);
    expect(result.metrics.throughput).toBeGreaterThan(0);
    expect(result.metrics.pendingTasks).toBe(0);
    expect(result.metrics.replans).toBeGreaterThan(0);
    expect(events.some((event) => event.type === "replan")).toBe(true);
    expect(events.some((event) => event.type === "move")).toBe(true);
  });

  it("w より遠い goal でも path を切らずに到達し、service time を実到達時刻で測る", async () => {
    const scenario = longLifelongScenario();
    const { result } = await solve("rhcr", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      horizon: 60,
      extra: { planningWindow: 4, replanningPeriod: 2 },
    });
    expect(result.outcome).toBe("solved");
    expect(result.metrics.pendingTasks).toBe(0);
    expect(result.metrics.averageServiceTime).toBe(11);
  });

  it("one-shot Scenario は固定 goal queue へ変換して実行できる", async () => {
    const { result } = await solve("rhcr", oneShotSwap(), {
      ...DEFAULT_SOLVER_OPTIONS,
      horizon: 30,
      extra: { planningWindow: 4, replanningPeriod: 2 },
    });
    expect(result.outcome).toBe("solved");
    expect(result.warnings?.some((warning) => warning.message.includes("one-shot Scenario"))).toBe(
      true,
    );
  });

  it("w < h は拒否し one-shot は固定 queue として受け付ける", async () => {
    const badWindow = await solve("rhcr", lifelongScenario(), {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { planningWindow: 1, replanningPeriod: 2 },
    });
    expect(badWindow.result.outcome).toBe("error");
    expect(badWindow.result.failureReason).toBe("internal");

    const oneShot = await solve("rhcr", oneShotSwap());
    expect(oneShot.result.outcome).toBe("solved");
    expect(checkPaths(oneShotSwap(), oneShot.result.paths)).toEqual([]);
    expect(
      oneShot.result.warnings?.some((warning) => warning.message.includes("one-shot Scenario")),
    ).toBe(true);
  });

  /*
    RHCR も MAPF-LNS / MAPF-LNS2 と同じく、失敗を解の非存在と読ませてはいけない。
    原論文の結論（p.8）が completeness を保証しないと明記している以上、
    windowed 優先順位付き計画が詰まっただけで「解なし」と見せるのは過大主張になる。
  */
  it("解けなかったとき、解の非存在の証明ではないと警告する", async () => {
    const scenario = priorityDeadEndSwap();
    const { result } = await solve("rhcr", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      horizon: 40,
      extra: { planningWindow: 8, replanningPeriod: 2 },
    });
    expect(result.outcome).not.toBe("solved");
    expect(
      result.warnings?.some((warning) =>
        warning.message.includes("解の非存在の証明ではありません"),
      ),
    ).toBe(true);
  });

  /*
    horizon の既定値は w から導いてはいけない。
    w は衝突解消の先読み長で、何 step 運転するかとは無関係な量である。
    以前は w * 4 だったため、既定 w=8 では 32 step しか回らず、
    goal まで 30 step 超かかるマップが RHCR と無関係な理由で失敗していた。
  */
  it("既定 horizon は w に依存せず、w が小さくても遠い goal を処理しきる", async () => {
    const scenario = longLifelongScenario(); // goal は 11 step 先
    const small = await solve("rhcr", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { planningWindow: 2, replanningPeriod: 1 },
    });
    expect(small.result.outcome).toBe("solved");
    expect(small.result.metrics.pendingTasks).toBe(0);

    // w を変えても運転時間は変わらない = 結果が w に引きずられない。
    const large = await solve("rhcr", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { planningWindow: 9, replanningPeriod: 1 },
    });
    expect(large.result.outcome).toBe("solved");
    expect(large.result.metrics.averageServiceTime).toBe(small.result.metrics.averageServiceTime);
  });
});
