import { describe, expect, it } from "vitest";
import type { Scenario, SolverOptions, SolverResult } from "@/lib/model/types";
import { DEFAULT_RULES, DEFAULT_SOLVER_OPTIONS } from "@/lib/model/types";
import { createEmptyMap } from "@/lib/model/grid";
import { createRecordingContext } from "@/solvers/context";
import { getSolver } from "@/solvers/registry";
import { jointStateBfs, jointStateOptimalSumOfCosts } from "@/solvers/reference/joint-state";
import { checkPaths } from "../helpers/check-paths";

const BATCH_5_IDS = ["lacam", "lacam-star"] as const;

async function solve(
  solverId: (typeof BATCH_5_IDS)[number],
  scenario: Scenario,
  options: SolverOptions = DEFAULT_SOLVER_OPTIONS,
) {
  const solver = getSolver(solverId);
  expect(solver, `${solverId} が registry に無い`).toBeDefined();
  const { context, events } = createRecordingContext(scenario.seed);
  const result = await solver!.solve(scenario, options, context);
  return { solver: solver!, result, events };
}

function expectValid(scenario: Scenario, result: SolverResult): void {
  expect(result.outcome).toBe("solved");
  expect(checkPaths(scenario, result.paths)).toEqual([]);
  expect(result.conflicts).toEqual([]);
}

function swapWithDetour(seed = 1): Scenario {
  return {
    id: `lacam-swap-${seed}`,
    name: "3x2 swap with detour",
    kind: "one-shot-mapf",
    map: createEmptyMap(3, 2),
    agents: [
      { id: "a1", start: { x: 0, y: 0 }, goal: { x: 2, y: 0 } },
      { id: "a2", start: { x: 2, y: 0 }, goal: { x: 0, y: 0 } },
    ],
    rules: DEFAULT_RULES,
    seed,
  };
}

function impossibleSwap(): Scenario {
  return {
    id: "lacam-impossible-swap",
    name: "2x1 edge swap",
    kind: "one-shot-mapf",
    map: createEmptyMap(2, 1),
    agents: [
      { id: "a1", start: { x: 0, y: 0 }, goal: { x: 1, y: 0 } },
      { id: "a2", start: { x: 1, y: 0 }, goal: { x: 0, y: 0 } },
    ],
    rules: DEFAULT_RULES,
    seed: 2,
  };
}

describe("Batch 5 registry と metadata", () => {
  it("LaCAM / LaCAM* を実装と検証状態どおり登録する", () => {
    for (const id of BATCH_5_IDS) {
      const solver = getSolver(id);
      expect(solver).toBeDefined();
      expect(solver!.metadata.status).toBe("runnable");
      expect(solver!.metadata.fidelity).toBe(
        id === "lacam" ? "paper-faithful" : "reference-validated",
      );
      expect(solver!.metadata.unsupportedRules).toContain("allowDiagonal");
      expect(solver!.metadata.unsupportedRules).toContain("forbidFollowing");
      expect(solver!.metadata.unsupportedRules).toContain("goalBehavior");
    }
  });
});

describe("LaCAM", () => {
  it("高レベル DFS と lazy constraints で detour swap を解く", async () => {
    const scenario = swapWithDetour(4);
    const { result, events } = await solve("lacam", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
    });
    expectValid(scenario, result);
    for (const type of [
      "configuration-expand",
      "create-low-level-node",
      "add-lazy-constraint",
      "configuration-generate",
    ] as const) {
      expect(
        events.some((event) => event.type === type),
        type,
      ).toBe(true);
      expect(
        result.trace?.some((event) => event.type === type),
        type,
      ).toBe(true);
    }
    expect(result.metrics.expandedNodes).toBeGreaterThan(0);
    expect(result.metrics.generatedNodes).toBeGreaterThan(0);
  });

  it("全 constraint leaf を調べ、edge swap しかない instance を no-solution と証明する", async () => {
    const scenario = impossibleSwap();
    expect(jointStateBfs(scenario, 8).solved).toBe(false);
    const { result } = await solve("lacam", scenario);
    expect(result.outcome).toBe("no-solution");
    expect(result.failureReason).toBe("search-exhausted");
  });
});

describe("LaCAM*", () => {
  it("OPEN exhaustion まで探索し、小規模 fixture で SOC oracle と一致する", async () => {
    const scenario = swapWithDetour(5);
    const oracle = jointStateOptimalSumOfCosts(scenario, 8);
    expect(oracle.solved).toBe(true);
    expect(oracle.sumOfCostsCertified).toBe(true);

    const { result, events } = await solve("lacam-star", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
    });
    expectValid(scenario, result);
    // この fixture の optimal path は goal を途中離脱しないため、paper の
    // sum-of-loss optimum とサイト共通 SOC optimum が一致する。
    expect(result.metrics.sumOfCosts).toBe(oracle.sumOfCosts);
    expect(result.metrics.makespan).toBe(4);
    expect(events.some((event) => event.type === "update-incumbent")).toBe(true);
    // 探索を完遂しており、かつ上のコメントのとおり両目的関数が一致する
    // fixture なので、但し書きは 1 つも要らない。
    expect(result.warnings ?? []).toHaveLength(0);
  });

  it("既知 configuration への辺を追加して shortest-path tree を張り替える", async () => {
    const scenario = swapWithDetour(9);
    const { result, events } = await solve("lacam-star", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
    });
    expectValid(scenario, result);
    expect(events.some((event) => event.type === "rewire-configuration")).toBe(true);
    expect(result.trace?.some((event) => event.type === "rewire-configuration")).toBe(true);
  });

  it("初解後の node limit では incumbent path を保持しつつ最適と扱わない", async () => {
    const scenario = swapWithDetour(9);
    let interrupted: SolverResult | undefined;
    for (let maxExpansions = 1; maxExpansions <= 200; maxExpansions += 1) {
      const { result } = await solve("lacam-star", scenario, {
        ...DEFAULT_SOLVER_OPTIONS,
        maxExpansions,
      });
      if (result.outcome === "node-limit" && result.paths.length > 0) {
        interrupted = result;
        break;
      }
    }
    expect(interrupted).toBeDefined();
    expect(interrupted!.outcome).toBe("node-limit");
    expect(interrupted!.failureReason).toBe("limit-exceeded");
    expect(checkPaths(scenario, interrupted!.paths)).toEqual([]);
  });
});

describe("Batch 5 共通の安全弁・決定性・rules", () => {
  it("seed が同じなら結果が決定的で、複数 seed の solved path は妥当", async () => {
    for (const id of BATCH_5_IDS) {
      const first = await solve(id, swapWithDetour(7));
      const second = await solve(id, swapWithDetour(7));
      expect(first.result.outcome).toBe(second.result.outcome);
      expect(first.result.paths).toEqual(second.result.paths);

      for (const seed of [1, 2, 3, 4, 5]) {
        const scenario = swapWithDetour(seed);
        const { result } = await solve(id, scenario);
        expectValid(scenario, result);
      }
    }
  });

  it("timeout、node limit、AbortSignal、path-length cutoff を構造化する", async () => {
    const timedOut = await solve("lacam", swapWithDetour(), {
      ...DEFAULT_SOLVER_OPTIONS,
      timeoutMs: 0,
    });
    expect(timedOut.result.outcome).toBe("timeout");

    const limited = await solve("lacam-star", swapWithDetour(), {
      ...DEFAULT_SOLVER_OPTIONS,
      maxExpansions: 1,
    });
    expect(limited.result.outcome).toBe("node-limit");
    expect(limited.result.metrics.expandedNodes).toBe(1);

    const solver = getSolver("lacam")!;
    const controller = new AbortController();
    controller.abort();
    const { context } = createRecordingContext(1, controller.signal);
    const aborted = await solver.solve(swapWithDetour(), DEFAULT_SOLVER_OPTIONS, context);
    expect(aborted.outcome).toBe("aborted");

    const horizon = await solve("lacam", swapWithDetour(), {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { maxPathLength: 1 },
    });
    expect(horizon.result.outcome).toBe("node-limit");
    expect(horizon.result.failureReason).toBe("limit-exceeded");
    expect(
      horizon.result.warnings?.some((warning) => warning.message.includes("解不存在の証明では")),
    ).toBe(true);
  });

  it("入力 guard、未対応 rule、option validation、trace limit を守る", async () => {
    const guarded = await solve("lacam", swapWithDetour(), {
      ...DEFAULT_SOLVER_OPTIONS,
      maxAgents: 1,
    });
    expect(guarded.result.outcome).toBe("error");
    expect(guarded.result.failureReason).toBe("limit-exceeded");

    const following = await solve("lacam-star", {
      ...swapWithDetour(),
      rules: { ...DEFAULT_RULES, forbidFollowing: true },
    });
    expect(following.result.outcome).toBe("error");
    expect(following.result.error?.code).toBe("unsupported-rules");

    const invalidOption = await solve("lacam", swapWithDetour(), {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { maxPathLength: 0 },
    });
    expect(invalidOption.result.outcome).toBe("error");
    expect(invalidOption.result.error?.code).toBe("invalid-scenario");

    const traced = await solve("lacam", swapWithDetour(), {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "verbose",
      maxTraceEvents: 1,
    });
    expectValid(swapWithDetour(), traced.result);
    expect(traced.result.trace).toHaveLength(1);
    expect(traced.result.warnings?.some((warning) => warning.code === "trace-truncated")).toBe(
      true,
    );
  });
});
