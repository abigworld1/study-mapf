import { describe, expect, it } from "vitest";
import { createEmptyMap } from "@/lib/model/grid";
import { sumOfCosts } from "@/lib/model/conflicts";
import { DEFAULT_RULES, DEFAULT_SOLVER_OPTIONS, type Scenario } from "@/lib/model/types";
import {
  buildPreset,
  scenarioFromJson,
  scenarioToJson,
  validateScenario,
} from "@/lib/model/scenario";
import { galeShapley, hasBlockingPair } from "@/lib/assignment/gale-shapley";
import { hungarianMethod } from "@/lib/assignment/hungarian";
import { MinCostMaxFlow } from "@/lib/flow/min-cost-max-flow";
import { minCostMaxFlowSolver } from "@/solvers/tapf/mcmf-solver";
import { tapfSocOracle } from "@/solvers/reference/tapf-soc";
import { getSolver, solversFor } from "@/solvers/registry";
import { createRecordingContext } from "@/solvers/context";
import { checkPaths } from "../helpers/check-paths";

async function solve(id: string, scenario: Scenario) {
  const recording = createRecordingContext(scenario.seed);
  const result = await getSolver(id)!.solve(scenario, DEFAULT_SOLVER_OPTIONS, recording.context);
  return result;
}

describe("Batch 7 assignment primitives", () => {
  it("最小費用最大流は残余辺を使って要求 flow を送る", () => {
    const flow = new MinCostMaxFlow(4);
    flow.addEdge(0, 1, 1, 0);
    flow.addEdge(0, 2, 1, 0);
    flow.addEdge(1, 3, 1, 2);
    flow.addEdge(2, 3, 1, 1);
    const result = flow.solve(0, 3, 2);
    expect(result.flow).toBe(2);
    expect(result.cost).toBe(3);
  });

  it("Hungarian 法は矩形コスト行列の最小割当を返す", () => {
    const result = hungarianMethod([
      [4, 1, 3],
      [2, 0, 5],
    ]);
    expect(result?.assignment).toEqual([1, 0]);
    expect(result?.cost).toBe(3);
  });

  it("Gale-Shapley は blocking pair のないマッチングを返す", () => {
    const matching = galeShapley(
      [
        [0, 1],
        [0, 1],
      ],
      [
        [1, 0],
        [0, 1],
      ],
    );
    expect(
      hasBlockingPair(
        matching,
        [
          [0, 1],
          [0, 1],
        ],
        [
          [1, 0],
          [0, 1],
        ],
      ),
    ).toBe(false);
  });

  it("libMultiRobotPlanning assignment の固定行列と最小コストが一致する", () => {
    const result = hungarianMethod([
      [90, 76, 75, 80],
      [35, 85, 55, 65],
      [125, 95, 90, 105],
      [45, 110, 95, 115],
    ]);
    expect(result?.cost).toBe(275);
    expect(result?.assignment).toEqual([3, 2, 1, 0]);
  });
});

describe("Batch 7 TAPF", () => {
  it("CBM と MCMF は TAPF プリセットを解き、目的関数を明示する", async () => {
    const scenario = buildPreset("tapf-crossing", 1);
    const cbm = await solve("cbm", scenario);
    const flow = await solve("min-cost-max-flow", scenario);
    expect(cbm.outcome).toBe("solved");
    expect(flow.outcome).toBe("solved");
    expect(cbm.objective).toBe("makespan");
    expect(flow.objective).toBe("makespan");
    expect(cbm.conflicts).toEqual([]);
    expect(flow.conflicts).toEqual([]);
    expect(
      checkPaths(
        {
          ...scenario,
          kind: "one-shot-mapf",
          agents: scenario.agents.map((agent, index) => ({
            ...agent,
            goal: cbm.targetAssignments?.[index]?.goal,
          })),
        },
        cbm.paths,
      ),
    ).toEqual([]);
  });

  it("CBM は複数チームのプリセットも解く", async () => {
    const result = await solve("cbm", buildPreset("tapf-two-teams", 1));
    expect(result.outcome).toBe("solved");
    expect(result.conflicts).toEqual([]);
  });

  it("CBM の makespan は TAPF baseline と一致する", async () => {
    for (const id of ["tapf-anonymous", "tapf-crossing", "tapf-two-teams"]) {
      const scenario = buildPreset(id, 1);
      const baseline = await solve("tapf-baseline", scenario);
      const cbm = await solve("cbm", scenario);
      expect(baseline.outcome, id).toBe("solved");
      expect(cbm.outcome, id).toBe("solved");
      expect(cbm.metrics.makespan, id).toBe(baseline.metrics.makespan);
    }
  });

  it("CBS-TA は一般の rectangular assignment を受け、SOC を目的にする", async () => {
    const scenario: Scenario = {
      id: "rectangular-ta",
      name: "rectangular-ta",
      kind: "tapf",
      map: createEmptyMap(5, 2),
      agents: [
        { id: "a1", start: { x: 0, y: 0 } },
        { id: "a2", start: { x: 0, y: 1 } },
        { id: "a3", start: { x: 1, y: 0 } },
      ],
      assignment: {
        targets: [
          { id: "g1", cell: { x: 4, y: 0 } },
          { id: "g2", cell: { x: 4, y: 1 } },
        ],
        allowed: [
          [true, true],
          [true, true],
          [false, true],
        ],
      },
      rules: DEFAULT_RULES,
      seed: 1,
    };
    expect(validateScenario(scenario)).toEqual([]);
    const restored = scenarioFromJson(JSON.parse(JSON.stringify(scenarioToJson(scenario))));
    expect(restored.assignment).toEqual(scenario.assignment);
    const result = await solve("cbs-ta", scenario);
    expect(result.outcome).toBe("solved");
    expect(result.objective).toBe("sum-of-costs");
    expect(result.targetAssignments).toHaveLength(2);
    expect(result.conflicts).toEqual([]);
  });

  it("割当のない agent は退避し、退避分を SOC 内訳 warning で示す", async () => {
    const scenario: Scenario = {
      id: "parking-ta",
      name: "parking-ta",
      kind: "tapf",
      map: createEmptyMap(6, 3),
      agents: [
        { id: "a1", start: { x: 0, y: 0 } },
        { id: "a2", start: { x: 0, y: 1 } },
        { id: "a3", start: { x: 0, y: 2 } },
      ],
      assignment: {
        targets: [{ id: "g1", cell: { x: 5, y: 0 } }],
        allowed: [[true], [false], [false]],
      },
      rules: DEFAULT_RULES,
      seed: 1,
    };
    const result = await solve("cbs-ta", scenario);
    expect(result.outcome).toBe("solved");
    expect(result.metrics.sumOfCosts).toBe(12);
    const pathsByAgent = new Map(result.paths.map((path) => [path.agentId, path]));
    expect(sumOfCosts([pathsByAgent.get("a1")!])).toBe(5);
    expect(sumOfCosts([pathsByAgent.get("a2")!, pathsByAgent.get("a3")!])).toBe(7);
    expect(pathsByAgent.get("a1")?.positions.at(-1)?.cell).toEqual({ x: 5, y: 0 });
    expect(pathsByAgent.get("a2")?.positions.at(-1)?.cell).toEqual({ x: 5, y: 2 });
    expect(pathsByAgent.get("a3")?.positions.at(-1)?.cell).toEqual({ x: 1, y: 2 });
    expect(
      result.warnings?.some(
        (warning) =>
          warning.message.includes("退避の移動量は 7 歩") &&
          warning.message.includes("SOC 内訳は target 側 5 + 退避側 7 = 12"),
      ),
    ).toBe(true);
  });

  it("CBS-TA の SOC は小規模な割当列挙オラクルと一致する", async () => {
    const scenario = buildPreset("tapf-crossing", 1);
    const oracle = await tapfSocOracle(scenario);
    const result = await solve("cbs-ta", scenario);
    expect(oracle.solved).toBe(true);
    expect(oracle.sumOfCostsCertified).toBe(true);
    expect(result.outcome).toBe("solved");
    expect(result.objective).toBe("sum-of-costs");
    expect(result.metrics.sumOfCosts).toBe(oracle.sumOfCosts);
  });

  it("libMultiRobotPlanning の mapfta_simple1_a1/a2/a3 と同じ SOC を得る", async () => {
    const map = createEmptyMap(5, 2);
    const blocked = [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 1 },
    ];
    const mapWithObstacles = blocked.reduce(
      (current, cell) => ({
        ...current,
        blocked: current.blocked.map((value, index) =>
          index === cell.y * current.width + cell.x ? true : value,
        ),
      }),
      map,
    );
    const make = (
      id: string,
      targetCells: readonly { x: number; y: number }[],
      allowed: readonly (readonly boolean[])[],
    ) => ({
      id,
      name: id,
      kind: "tapf" as const,
      map: mapWithObstacles,
      agents: [
        { id: "agent0", start: { x: 0, y: 0 } },
        { id: "agent1", start: { x: 1, y: 0 } },
      ],
      assignment: {
        targets: targetCells.map((cell, index) => ({ id: `t${index}`, cell })),
        allowed,
      },
      rules: DEFAULT_RULES,
      seed: 1,
    });
    expect(
      (
        await solve(
          "cbs-ta",
          make(
            "a1",
            [
              { x: 4, y: 0 },
              { x: 3, y: 0 },
            ],
            [
              [true, true],
              [true, true],
            ],
          ) as Scenario,
        )
      ).metrics.sumOfCosts,
    ).toBe(6);
    const a2 = await solve("cbs-ta", make("a2", [{ x: 4, y: 0 }], [[true], [false]]) as Scenario);
    expect(a2.metrics.sumOfCosts).toBe(6);
    expect(
      (await solve("cbs-ta", make("a3", [{ x: 3, y: 0 }], [[true], [false]]) as Scenario)).metrics
        .sumOfCosts,
    ).toBe(5);
  });

  it("形状述語は CBM/MCMF/CBS-TA の選択肢を分ける", () => {
    const team = buildPreset("tapf-crossing", 1);
    const assignment: Scenario = {
      ...team,
      teams: undefined,
      assignment: {
        targets: [{ id: "g", cell: { x: 6, y: 0 } }],
        allowed: [[true], [true]],
      },
    };
    expect(solversFor("tapf", team).some((solver) => solver.metadata.id === "cbm")).toBe(true);
    expect(solversFor("tapf", assignment).some((solver) => solver.metadata.id === "cbm")).toBe(
      false,
    );
    expect(
      solversFor("tapf", assignment).some((solver) => solver.metadata.id === "tapf-baseline"),
    ).toBe(false);
    expect(solversFor("tapf", assignment).some((solver) => solver.metadata.id === "cbs-ta")).toBe(
      true,
    );
    expect(minCostMaxFlowSolver.canSolve?.(assignment)).toBe(false);
    const malformed = { ...team, assignment: assignment.assignment };
    expect(solversFor("tapf", malformed).some((solver) => solver.metadata.id === "cbm")).toBe(
      false,
    );
    expect(solversFor("tapf", malformed).some((solver) => solver.metadata.id === "cbs-ta")).toBe(
      false,
    );
  });
});
