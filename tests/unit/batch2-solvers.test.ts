import { describe, expect, it } from "vitest";
import type { Scenario, SolverOptions, SolverResult } from "@/lib/model/types";
import { DEFAULT_RULES, DEFAULT_SOLVER_OPTIONS } from "@/lib/model/types";
import { createEmptyMap } from "@/lib/model/grid";
import { createRecordingContext } from "@/solvers/context";
import { getSolver } from "@/solvers/registry";
import { jointStateOptimalSumOfCosts } from "@/solvers/reference/joint-state";
import { constrainedFocalAStar } from "@/solvers/cbs/low-level";
import { detectConflicts } from "@/lib/model/conflicts";
import { checkPaths } from "../helpers/check-paths";

const BATCH_2_IDS = ["cbs", "bcbs", "ecbs", "icbs", "eecbs"] as const;

function swapWithDetour(): Scenario {
  return {
    id: "tiny-swap",
    name: "tiny swap with detour",
    kind: "one-shot-mapf",
    map: createEmptyMap(3, 2),
    agents: [
      { id: "a1", start: { x: 0, y: 0 }, goal: { x: 2, y: 0 } },
      { id: "a2", start: { x: 2, y: 0 }, goal: { x: 0, y: 0 } },
    ],
    rules: DEFAULT_RULES,
    seed: 9,
  };
}

function helpfulBypassScenario(): Scenario {
  return {
    id: "helpful-bypass",
    name: "helpful bypass",
    kind: "one-shot-mapf",
    map: createEmptyMap(4, 3),
    agents: [
      { id: "a1", start: { x: 0, y: 2 }, goal: { x: 3, y: 1 } },
      { id: "a2", start: { x: 1, y: 2 }, goal: { x: 1, y: 0 } },
      { id: "a3", start: { x: 2, y: 0 }, goal: { x: 1, y: 1 } },
    ],
    rules: DEFAULT_RULES,
    seed: 5,
  };
}

async function solve(
  solverId: string,
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

describe("Batch 2 registry と metadata", () => {
  it("5 Solver を実装状態に合わせて登録する", () => {
    for (const id of BATCH_2_IDS) {
      const solver = getSolver(id);
      expect(solver).toBeDefined();
      expect(solver!.metadata.status).toBe(id === "icbs" ? "partial" : "runnable");
      expect(solver!.metadata.fidelity).toBe("paper-faithful");
      expect(solver!.metadata.unsupportedRules).toContain("allowDiagonal");
      // following 禁止は扱える（detectConflicts が返し、constraintsFor が分岐を持つ）。
      expect(solver!.metadata.unsupportedRules).not.toContain("forbidFollowing");
    }
  });
});

describe("CBS / ICBS の最適性", () => {
  it.each(["cbs", "icbs"] as const)("%s が certified SOC optimum と一致する", async (id) => {
    const scenario = swapWithDetour();
    const oracle = jointStateOptimalSumOfCosts(scenario, 8);
    expect(oracle.solved).toBe(true);
    expect(oracle.sumOfCostsCertified).toBe(true);

    const { result } = await solve(id, scenario);
    expectValid(scenario, result);
    expect(result.metrics.sumOfCosts).toBe(oracle.sumOfCosts);
    expect(result.metrics.lowerBound).toBe(result.metrics.sumOfCosts);
  });

  it("ICBS が conflict を分類する", async () => {
    const scenario = swapWithDetour();
    const { result, events } = await solve("icbs", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
    });
    expectValid(scenario, result);
    expect(events.some((event) => event.type === "classify-conflict")).toBe(true);
    expect(result.trace?.some((event) => event.type === "classify-conflict")).toBe(true);
  });

  it("ICBS が同 cost で conflict を減らす helpful bypass を採用する", async () => {
    const scenario = helpfulBypassScenario();
    const oracle = jointStateOptimalSumOfCosts(scenario, 8);
    expect(oracle.solved && oracle.sumOfCostsCertified).toBe(true);
    const { result, events } = await solve("icbs", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
    });
    expectValid(scenario, result);
    expect(result.metrics.sumOfCosts).toBe(oracle.sumOfCosts);
    expect(events.some((event) => event.type === "bypass")).toBe(true);
    expect(result.trace?.some((event) => event.type === "bypass")).toBe(true);
  });
});

describe("CBS low level", () => {
  it("vertex constraint と edge constraint を時刻どおりに守る", () => {
    const scenario = swapWithDetour();
    const agent = scenario.agents[0]!;
    expect(agent.goal).toBeDefined();
    let remaining = 1_000;
    const output = constrainedFocalAStar({
      map: scenario.map,
      agent: { ...agent, goal: agent.goal! },
      rules: scenario.rules,
      constraints: [
        { kind: "vertex", agentId: agent.id, cell: { x: 1, y: 0 }, time: 1 },
        {
          kind: "edge",
          agentId: agent.id,
          from: { x: 0, y: 0 },
          to: { x: 0, y: 1 },
          time: 1,
        },
      ],
      otherPaths: [],
      weight: 1,
      maxTime: 10,
      consumeExpansion: () => {
        remaining -= 1;
        return remaining >= 0 ? "ok" : "node-limit";
      },
    });
    expect(output.path).not.toBeNull();
    expect(output.path!.positions[1]!.cell).toEqual({ x: 0, y: 0 });
    expect(output.path!.positions.at(-1)!.time).toBe(3);
    expect(output.lowerBound).toBe(3);
  });

  it("positive constraint の対象 agent が指定時刻の頂点と辺を必ず通る", () => {
    const scenario = swapWithDetour();
    const agent = scenario.agents[0]!;
    expect(agent.goal).toBeDefined();
    let remaining = 1_000;
    const output = constrainedFocalAStar({
      map: scenario.map,
      agent: { ...agent, goal: agent.goal! },
      rules: scenario.rules,
      constraints: [
        {
          kind: "vertex",
          agentId: agent.id,
          cell: { x: 0, y: 1 },
          time: 1,
          positive: true,
        },
        {
          kind: "edge",
          agentId: agent.id,
          from: { x: 0, y: 1 },
          to: { x: 1, y: 1 },
          time: 2,
          positive: true,
        },
      ],
      otherPaths: [],
      weight: 1,
      maxTime: 10,
      consumeExpansion: () => {
        remaining -= 1;
        return remaining >= 0 ? "ok" : "node-limit";
      },
    });
    expect(output.path).not.toBeNull();
    expect(output.path!.positions[1]!.cell).toEqual({ x: 0, y: 1 });
    expect(output.path!.positions[2]!.cell).toEqual({ x: 1, y: 1 });
  });

  it("別 agent の positive constraint を暗黙の負制約として扱う", () => {
    const scenario = swapWithDetour();
    const agent = scenario.agents[0]!;
    expect(agent.goal).toBeDefined();
    let remaining = 1_000;
    const output = constrainedFocalAStar({
      map: scenario.map,
      agent: { ...agent, goal: agent.goal! },
      rules: scenario.rules,
      constraints: [
        {
          kind: "vertex",
          agentId: "other-agent",
          cell: { x: 1, y: 0 },
          time: 1,
          positive: true,
        },
      ],
      otherPaths: [],
      weight: 1,
      maxTime: 10,
      consumeExpansion: () => {
        remaining -= 1;
        return remaining >= 0 ? "ok" : "node-limit";
      },
    });
    expect(output.path).not.toBeNull();
    expect(output.path!.positions[1]!.cell).not.toEqual({ x: 1, y: 0 });
  });
});

describe("BCBS / ECBS / EECBS の bounded suboptimality", () => {
  it.each(["bcbs", "ecbs", "eecbs"] as const)(
    "%s が certified optimum の w 倍以内を返す",
    async (id) => {
      const scenario = swapWithDetour();
      const oracle = jointStateOptimalSumOfCosts(scenario, 8);
      expect(oracle.solved && oracle.sumOfCostsCertified).toBe(true);
      const w = 1.5;
      const { result } = await solve(id, scenario, {
        ...DEFAULT_SOLVER_OPTIONS,
        suboptimalityFactor: w,
      });
      expectValid(scenario, result);
      expect(result.metrics.sumOfCosts).toBeLessThanOrEqual(w * oracle.sumOfCosts + 1e-9);
      expect(result.metrics.lowerBound).toBeDefined();
      expect(result.metrics.suboptimalityBound).toBeLessThanOrEqual(w + 1e-9);
    },
  );

  it.each(["bcbs", "ecbs", "eecbs"] as const)("%s は w=1 で最適 cost を返す", async (id) => {
    const scenario = swapWithDetour();
    const oracle = jointStateOptimalSumOfCosts(scenario, 8);
    const { result } = await solve(id, scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      suboptimalityFactor: 1,
    });
    expectValid(scenario, result);
    expect(result.metrics.sumOfCosts).toBe(oracle.sumOfCosts);
  });

  it("BCBS の wH*wL を検証する", async () => {
    const scenario = swapWithDetour();
    const invalid = await solve("bcbs", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      suboptimalityFactor: 1.5,
      extra: { highLevelWeight: 1.5, lowLevelWeight: 1.5 },
    });
    expect(invalid.result.outcome).toBe("error");
    expect(invalid.result.error?.code).toBe("invalid-scenario");

    const valid = await solve("bcbs", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      suboptimalityFactor: 1.5,
      extra: { highLevelWeight: 1.25, lowLevelWeight: 1.2 },
    });
    expectValid(scenario, valid.result);
  });
});

describe("CBS 系共通の安全性と可視化", () => {
  it("CT、constraint、replan、conflict の event を流す", async () => {
    const scenario = swapWithDetour();
    const { result, events } = await solve("cbs", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
    });
    expectValid(scenario, result);
    for (const type of [
      "create-ct-node",
      "detect-conflict",
      "add-constraint",
      "low-level-replan",
      "finish",
    ] as const) {
      expect(
        events.some((event) => event.type === type),
        type,
      ).toBe(true);
    }
    expect(result.metrics.replans).toBeGreaterThan(0);
    expect(result.metrics.conflictsDetected).toBeGreaterThan(0);
  });

  it("同じ入力では 5 Solver とも決定的", async () => {
    const scenario = swapWithDetour();
    for (const id of BATCH_2_IDS) {
      const options = {
        ...DEFAULT_SOLVER_OPTIONS,
        ...(id === "cbs" || id === "icbs" ? {} : { suboptimalityFactor: 1.5 }),
      };
      const first = await solve(id, scenario, options);
      const second = await solve(id, scenario, options);
      expect(first.result.paths).toEqual(second.result.paths);
      expect(first.result.metrics.sumOfCosts).toBe(second.result.metrics.sumOfCosts);
    }
  });

  it("展開上限を全 high/low-level search で共有する", async () => {
    const { result } = await solve("cbs", swapWithDetour(), {
      ...DEFAULT_SOLVER_OPTIONS,
      maxExpansions: 1,
    });
    expect(result.outcome).toBe("node-limit");
    expect(result.metrics.expandedNodes).toBe(1);
  });

  it("timeout、入力 guard、trace 上限を共通基盤で処理する", async () => {
    const scenario = swapWithDetour();
    const timedOut = await solve("ecbs", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      timeoutMs: 0,
    });
    expect(timedOut.result.outcome).toBe("timeout");

    const guarded = await solve("cbs", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      maxAgents: 1,
    });
    expect(guarded.result.outcome).toBe("error");
    expect(guarded.result.failureReason).toBe("limit-exceeded");
    expect(guarded.result.warnings?.some((warning) => warning.code === "input-too-large")).toBe(
      true,
    );

    const traced = await solve("cbs", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "verbose",
      maxTraceEvents: 1,
    });
    expectValid(scenario, traced.result);
    expect(traced.result.trace).toHaveLength(1);
    expect(traced.result.warnings?.some((warning) => warning.code === "trace-truncated")).toBe(
      true,
    );
  });

  it("AbortSignal と未対応 rule を構造化して返す", async () => {
    const scenario = swapWithDetour();
    const solver = getSolver("eecbs")!;
    const controller = new AbortController();
    controller.abort();
    const { context } = createRecordingContext(1, controller.signal);
    const aborted = await solver.solve(scenario, DEFAULT_SOLVER_OPTIONS, context);
    expect(aborted.outcome).toBe("aborted");

    /*
      ★ following 禁止は断らずに解く。受けた以上、返す解はその規則を満たすこと。
    */
    const followingInput: Scenario = {
      ...scenario,
      rules: { ...scenario.rules, forbidFollowing: true },
    };
    const following = await solve("cbs", followingInput);
    expect(following.result.outcome).toBe("solved");
    expect(detectConflicts(following.result.paths, followingInput.rules)).toEqual([]);
    expect(checkPaths(followingInput, following.result.paths)).toEqual([]);
  });
});
