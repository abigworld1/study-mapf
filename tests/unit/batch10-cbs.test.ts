import { describe, expect, it } from "vitest";
import type {
  Constraint,
  Scenario,
  SolverEvent,
  SolverOptions,
  SolverResult,
} from "@/lib/model/types";
import { DEFAULT_RULES, DEFAULT_SOLVER_OPTIONS } from "@/lib/model/types";
import { createEmptyMap } from "@/lib/model/grid";
import { createRecordingContext } from "@/solvers/context";
import { constrainedFocalAStar } from "@/solvers/cbs/low-level";
import { cardinalConflictGraphLowerBound } from "@/solvers/cbs/conflict-graph";
import { activeConstraintsForGroup } from "@/solvers/cbs/ma-constraints";
import { getSolver } from "@/solvers/registry";
import { jointStateOptimalSumOfCosts } from "@/solvers/reference/joint-state";
import { checkPaths } from "../helpers/check-paths";

function swapWithDetour(): Scenario {
  return {
    id: "batch10-swap",
    name: "batch10 swap",
    kind: "one-shot-mapf",
    map: createEmptyMap(3, 2),
    agents: [
      { id: "a1", start: { x: 0, y: 0 }, goal: { x: 2, y: 0 } },
      { id: "a2", start: { x: 2, y: 0 }, goal: { x: 0, y: 0 } },
    ],
    rules: DEFAULT_RULES,
    seed: 10,
  };
}

function helpfulBypassScenario(): Scenario {
  return {
    id: "batch10-helpful-bypass",
    name: "batch10 helpful bypass",
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

function eventState(event: SolverEvent): Readonly<Record<string, unknown>> | undefined {
  return event.type === "expand-node" && typeof event.state === "object" && event.state !== null
    ? (event.state as Readonly<Record<string, unknown>>)
    : undefined;
}

function lowLevel(constraints: readonly Constraint[], agentId = "a1") {
  const scenario = swapWithDetour();
  const agent = scenario.agents.find((candidate) => candidate.id === agentId)!;
  let remaining = 10_000;
  return constrainedFocalAStar({
    map: scenario.map,
    agent: { ...agent, goal: agent.goal! },
    rules: scenario.rules,
    constraints,
    otherPaths: [],
    weight: 1,
    maxTime: 12,
    consumeExpansion: () => {
      remaining -= 1;
      return remaining >= 0 ? "ok" : "node-limit";
    },
  });
}

describe("positive edge constraint", () => {
  it("対象 agent に指定時刻の有向辺を強制する", () => {
    const output = lowLevel([
      {
        kind: "edge",
        agentId: "a1",
        from: { x: 0, y: 1 },
        to: { x: 1, y: 1 },
        time: 2,
        positive: true,
      },
    ]);
    expect(output.path).not.toBeNull();
    expect(output.path!.positions[1]!.cell).toEqual({ x: 0, y: 1 });
    expect(output.path!.positions[2]!.cell).toEqual({ x: 1, y: 1 });
  });

  it("他 agent に endpoint 占有と逆向き edge swap を許さない", () => {
    const output = lowLevel(
      [
        {
          kind: "edge",
          agentId: "a1",
          from: { x: 1, y: 0 },
          to: { x: 2, y: 0 },
          time: 2,
          positive: true,
        },
      ],
      "a2",
    );
    expect(output.path).not.toBeNull();
    expect(output.path!.positions[1]!.cell).not.toEqual({ x: 1, y: 0 });
    expect([output.path!.positions[1]!.cell, output.path!.positions[2]!.cell]).not.toEqual([
      { x: 2, y: 0 },
      { x: 1, y: 0 },
    ]);
  });
});

describe("Disjoint Splitting", () => {
  it("registry へ paper-faithful Solver として登録する", () => {
    const solver = getSolver("disjoint-splitting");
    expect(solver).toBeDefined();
    expect(solver!.metadata.status).toBe("runnable");
    expect(solver!.metadata.fidelity).toBe("paper-faithful");
  });

  it("正負の排他的な 2 branch を作り、certified SOC optimum と一致する", async () => {
    const scenario = swapWithDetour();
    const oracle = jointStateOptimalSumOfCosts(scenario, 8);
    expect(oracle.solved && oracle.sumOfCostsCertified).toBe(true);
    const { result, events } = await solve("disjoint-splitting", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
    });
    expectValid(scenario, result);
    expect(result.metrics.sumOfCosts).toBe(oracle.sumOfCosts);
    const added = events.flatMap((event) =>
      event.type === "add-constraint" ? [event.constraint] : [],
    );
    expect(added.some((constraint) => constraint.positive === true)).toBe(true);
    expect(added.some((constraint) => constraint.positive !== true)).toBe(true);
  });

  it("同じ seed なら split agent の乱択を含めて決定的", async () => {
    const scenario = swapWithDetour();
    const first = await solve("disjoint-splitting", scenario);
    const second = await solve("disjoint-splitting", scenario);
    expect(first.result.paths).toEqual(second.result.paths);
    expect(first.result.metrics.sumOfCosts).toBe(second.result.metrics.sumOfCosts);
  });
});

describe("CBSH", () => {
  it("小規模 graph の minimum vertex cover を厳密に求める", () => {
    const triangle = cardinalConflictGraphLowerBound([
      { agentA: "a1", agentB: "a2" },
      { agentA: "a2", agentB: "a3" },
      { agentA: "a1", agentB: "a3" },
    ]);
    expect(triangle).toMatchObject({
      value: 2,
      method: "exact-minimum-vertex-cover",
      vertexCount: 3,
      edgeCount: 3,
    });
  });

  it("上限を超える graph では許容な maximal matching 下界へ切り替える", () => {
    const result = cardinalConflictGraphLowerBound(
      [
        { agentA: "a1", agentB: "a2" },
        { agentA: "a2", agentB: "a3" },
        { agentA: "a3", agentB: "a4" },
      ],
      3,
    );
    expect(result).toMatchObject({ value: 2, method: "maximal-matching" });
  });

  it("registry へ登録し、certified SOC optimum と一致する", async () => {
    const scenario = swapWithDetour();
    const oracle = jointStateOptimalSumOfCosts(scenario, 8);
    expect(oracle.solved && oracle.sumOfCostsCertified).toBe(true);
    const { solver, result, events } = await solve("cbsh", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
    });
    expect(solver.metadata.status).toBe("runnable");
    expect(solver.metadata.fidelity).toBe("paper-faithful");
    expectValid(scenario, result);
    expect(result.metrics.sumOfCosts).toBe(oracle.sumOfCosts);
    expect(
      events.some((event) => {
        const state = eventState(event);
        return state?.phase === "constraint-tree" && typeof state.heuristic === "number";
      }),
    ).toBe(true);
  });

  it("zero-cost bypass で goal に繋がり得る node の h を 0 にする", async () => {
    const scenario = helpfulBypassScenario();
    const oracle = jointStateOptimalSumOfCosts(scenario, 8);
    const { result, events } = await solve("cbsh", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
    });
    expectValid(scenario, result);
    expect(result.metrics.sumOfCosts).toBe(oracle.sumOfCosts);
    expect(events.some((event) => event.type === "bypass")).toBe(true);
    const bypassIndex = events.findIndex((event) => event.type === "bypass");
    const priorCtExpansion = events
      .slice(0, bypassIndex)
      .reverse()
      .find((event) => eventState(event)?.phase === "constraint-tree");
    expect(priorCtExpansion?.type).toBe("expand-node");
    expect(priorCtExpansion && eventState(priorCtExpansion)?.heuristic).toBe(0);
  });
});

describe("MA-CBS", () => {
  it("B=0 で最初の衝突対を併合し、joint low level でも最適値を返す", async () => {
    const scenario = swapWithDetour();
    const oracle = jointStateOptimalSumOfCosts(scenario, 8);
    const { solver, result, events } = await solve("ma-cbs", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
      extra: { mergeThreshold: 0 },
    });
    expect(solver.metadata.status).toBe("runnable");
    expect(solver.metadata.fidelity).toBe("paper-faithful");
    expectValid(scenario, result);
    expect(result.metrics.sumOfCosts).toBe(oracle.sumOfCosts);
    expect(events.some((event) => event.type === "merge-meta-agent")).toBe(true);
  });

  it("B=Infinity では素の CBS と同じ最適値になり、併合しない", async () => {
    const scenario = swapWithDetour();
    const cbs = await solve("cbs", scenario);
    const ma = await solve("ma-cbs", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
      extra: { mergeThreshold: Number.POSITIVE_INFINITY },
    });
    expectValid(scenario, ma.result);
    expect(ma.result.metrics.sumOfCosts).toBe(cbs.result.metrics.sumOfCosts);
    expect(ma.events.some((event) => event.type === "merge-meta-agent")).toBe(false);
  });

  it("併合サイズ上限を超えたら node-limit と警告で打ち切る", async () => {
    const { result } = await solve("ma-cbs", swapWithDetour(), {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { mergeThreshold: 0, maxMetaAgentSize: 1 },
    });
    expect(result.outcome).toBe("node-limit");
    expect(result.failureReason).toBe("limit-exceeded");
    expect(result.warnings?.some((warning) => warning.code === "input-too-large")).toBe(true);

    const invalidHardCap = await solve("ma-cbs", swapWithDetour(), {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { maxMetaAgentSize: 4 },
    });
    expect(invalidHardCap.result.outcome).toBe("error");
    expect(invalidHardCap.result.error?.code).toBe("invalid-scenario");
  });

  it("併合後は内部 constraint を捨て、外部 constraint を元 agent にだけ残す", () => {
    const internal: Constraint = {
      kind: "vertex",
      agentId: "a1",
      cell: { x: 1, y: 0 },
      time: 2,
    };
    const external: Constraint = {
      kind: "vertex",
      agentId: "a1",
      cell: { x: 2, y: 0 },
      time: 3,
    };
    const active = activeConstraintsForGroup(
      [
        {
          constraints: [internal],
          subjectAgentIds: ["a1"],
          opponentAgentIds: ["a2"],
        },
        {
          constraints: [external],
          subjectAgentIds: ["a1"],
          opponentAgentIds: ["a3"],
        },
      ],
      ["a1", "a2"],
    );
    expect(active).toEqual([external]);
  });
});

describe("horizon で打ち切ったときの申告", () => {
  /*
    ★ 打ち切ったなら failureReason も打ち切りだと言うこと。

      `search-exhausted` は「探索空間を尽くした」＝解の非存在の証明を意味する。
      horizon で切っただけでこれを返すと、散文の但し書きでは否定しながら
      機械可読なフィールドでは証明を主張することになる。読む側はフィールドを
      信じるので、そちらを直さないと意味がない。

      ★ fixture は horizon を明示して作る。narrow-corridor のような
        「重くて途中で終わる」盤面は outcome が timeout / no-solution の間で
        揺れるので、この検査には使えない（実際に揺れた）。
  */
  const tooShortHorizon = { ...DEFAULT_SOLVER_OPTIONS, horizon: 2 };

  function farApart(): Scenario {
    // 距離 7 の移動を horizon 2 で計画させる。低レベルは必ず max-time で失敗する。
    return {
      id: "short-horizon",
      name: "short-horizon",
      kind: "one-shot-mapf",
      map: createEmptyMap(8, 2),
      agents: [
        { id: "a1", start: { x: 0, y: 0 }, goal: { x: 7, y: 0 }, colorIndex: 0 },
        { id: "a2", start: { x: 7, y: 1 }, goal: { x: 0, y: 1 }, colorIndex: 1 },
      ],
      rules: DEFAULT_RULES,
      seed: 1,
    };
  }

  it.each(["cbs", "cbsh", "disjoint-splitting", "ma-cbs"])(
    "%s は horizon 打切りを limit-exceeded と申告する",
    async (id) => {
      const { result } = await solve(id, farApart(), tooShortHorizon);
      expect(result.outcome).not.toBe("solved");
      expect(result.failureReason, "打切りなのに探索を尽くしたと申告している").toBe(
        "limit-exceeded",
      );
      expect(
        (result.warnings ?? []).some((warning) => warning.message.includes("horizon")),
        "何で打ち切ったのかを言っていない",
      ).toBe(true);
    },
    120_000,
  );
});
