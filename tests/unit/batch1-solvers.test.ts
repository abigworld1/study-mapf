import { describe, expect, it } from "vitest";
import type { Scenario, SolverOptions } from "@/lib/model/types";
import { DEFAULT_RULES, DEFAULT_SOLVER_OPTIONS } from "@/lib/model/types";
import { createEmptyMap, lookupDistance, trueDistanceFrom, withBlocked } from "@/lib/model/grid";
import { makespanOf, sumOfCosts } from "@/lib/model/conflicts";
import { buildReservationTable, SimpleReservationTable } from "@/lib/model/reservation";
import { buildPreset } from "@/lib/model/scenario";
import { createRecordingContext } from "@/solvers/context";
import { getSolver } from "@/solvers/registry";
import { ReverseResumableAStar } from "@/solvers/low-level/reverse-resumable-astar";
import { sippSearch } from "@/solvers/low-level/sipp";
import { spaceTimeAStar } from "@/solvers/low-level/space-time-astar";
import { jointStateBfs } from "@/solvers/reference/joint-state";
import { checkPaths } from "../helpers/check-paths";

const BATCH_1_IDS = [
  "space-time-astar",
  "sipp",
  "prioritized-planning",
  "cooperative-astar",
  "hca-star",
  "whca-star",
] as const;

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

function singleAgentScenario(): Scenario {
  return {
    id: "single",
    name: "single",
    kind: "one-shot-mapf",
    map: createEmptyMap(5, 3),
    agents: [{ id: "a1", start: { x: 0, y: 1 }, goal: { x: 4, y: 1 } }],
    rules: DEFAULT_RULES,
    seed: 7,
  };
}

function centralRecessScenario(): Scenario {
  let map = createEmptyMap(5, 3);
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 5; x += 1) map = withBlocked(map, { x, y }, true);
  }
  for (let x = 0; x < 5; x += 1) map = withBlocked(map, { x, y: 1 }, false);
  map = withBlocked(map, { x: 2, y: 0 }, false);
  return {
    id: "central-recess",
    name: "central recess",
    kind: "one-shot-mapf",
    map,
    agents: [
      { id: "a1", start: { x: 0, y: 1 }, goal: { x: 4, y: 1 } },
      { id: "a2", start: { x: 4, y: 1 }, goal: { x: 0, y: 1 } },
    ],
    rules: DEFAULT_RULES,
    seed: 1,
  };
}

function expectValidSolved(
  scenario: Scenario,
  result: Awaited<ReturnType<typeof solve>>["result"],
) {
  expect(result.outcome).toBe("solved");
  expect(checkPaths(scenario, result.paths)).toEqual([]);
  expect(result.conflicts).toEqual([]);
  expect(result.metrics.sumOfCosts).toBe(sumOfCosts(result.paths));
  expect(result.metrics.makespan).toBe(makespanOf(result.paths));
}

describe("Batch 1 registry と metadata", () => {
  it("6 Solver が実装済みとして登録される", () => {
    for (const id of BATCH_1_IDS) {
      const solver = getSolver(id);
      expect(solver).toBeDefined();
      expect(solver!.metadata.status).toBe("runnable");
      expect(["paper-faithful", "reference-validated"]).toContain(solver!.metadata.fidelity);
      expect(solver!.metadata.unsupportedRules).toContain("allowDiagonal");
    }
  });
});

describe("Space-Time A*", () => {
  it("単一 agent の最短経路を返し、複数 agent を CA* と混同しない", async () => {
    const single = singleAgentScenario();
    const solved = await solve("space-time-astar", single);
    expectValidSolved(single, solved.result);
    expect(solved.result.metrics.sumOfCosts).toBe(4);

    const multiple = await solve("space-time-astar", buildPreset("swap-conflict", 1));
    expect(multiple.result.outcome).toBe("error");
    expect(multiple.result.error?.code).toBe("invalid-scenario");
  });

  it("following conflict の設定を予約検査へ反映する", () => {
    const map = createEmptyMap(3, 1);
    const table = new SimpleReservationTable();
    table.reservePath(
      {
        agentId: "other",
        positions: [
          { time: 0, cell: { x: 1, y: 0 } },
          { time: 1, cell: { x: 2, y: 0 } },
        ],
      },
      5,
    );
    const out = spaceTimeAStar({
      map,
      start: { x: 0, y: 0 },
      goal: { x: 1, y: 0 },
      agentId: "a1",
      rules: { ...DEFAULT_RULES, forbidFollowing: true },
      reservations: table,
      reservationHorizon: 5,
      maxTime: 5,
      maxExpansions: 100,
    });
    expect(out.path?.positions.at(-1)?.time).toBe(2);
  });

  it("disappear at goal では到着後の goal を予約し続けない", () => {
    const path = {
      agentId: "a1",
      positions: [
        { time: 0, cell: { x: 0, y: 0 } },
        { time: 1, cell: { x: 1, y: 0 } },
      ],
    } as const;
    const stay = buildReservationTable([path], 5, DEFAULT_RULES);
    const disappear = buildReservationTable([path], 5, {
      ...DEFAULT_RULES,
      goalBehavior: "disappear",
    });
    expect(stay.isReserved({ x: 1, y: 0 }, 5)).toBe(true);
    expect(disappear.isReserved({ x: 1, y: 0 }, 1)).toBe(true);
    expect(disappear.isReserved({ x: 1, y: 0 }, 2)).toBe(false);
  });
});

describe("SIPP low level", () => {
  it("長い予約を safe interval と wait-and-move で越える", () => {
    const map = createEmptyMap(3, 1);
    const table = new SimpleReservationTable();
    for (let time = 1; time <= 5; time += 1) table.reserve("other", { x: 1, y: 0 }, time);
    const intervals: string[] = [];
    const out = sippSearch({
      map,
      start: { x: 0, y: 0 },
      goal: { x: 2, y: 0 },
      agentId: "a1",
      rules: DEFAULT_RULES,
      reservations: table,
      maxTime: 10,
      maxExpansions: 100,
      onDiscoverInterval: (cell, interval) => {
        if (cell.x === 1) intervals.push(`${interval.start}-${interval.end}`);
      },
    });
    expect(out.path?.positions.at(-1)?.time).toBe(7);
    expect(intervals).toEqual(["0-0", "6-10"]);
    expect(out.safeIntervalsDiscovered).toBeGreaterThan(0);
  });

  it("同じ動的障害物で Space-Time A* と同じ最短到着時刻を返す", () => {
    const map = createEmptyMap(4, 2);
    const table = new SimpleReservationTable();
    table.reserve("other", { x: 1, y: 0 }, 1);
    table.reserve("other", { x: 2, y: 0 }, 2);
    const common = {
      map,
      start: { x: 0, y: 0 },
      goal: { x: 3, y: 0 },
      agentId: "a1",
      rules: DEFAULT_RULES,
      reservations: table,
      maxTime: 20,
      maxExpansions: 1_000,
    };
    const sipp = sippSearch(common);
    const sta = spaceTimeAStar({ ...common, reservationHorizon: 20 });
    expect(sipp.path?.positions.at(-1)?.time).toBe(sta.path?.positions.at(-1)?.time);
  });
});

describe("RRA* / CA* / HCA*", () => {
  it("RRA* の on-demand 距離が静的 true distance と一致する", () => {
    let map = createEmptyMap(7, 5);
    for (let y = 0; y < 4; y += 1) map = withBlocked(map, { x: 3, y }, true);
    const goal = { x: 6, y: 0 };
    const expected = trueDistanceFrom(map, goal);
    const rra = new ReverseResumableAStar({
      map,
      origin: { x: 0, y: 0 },
      goal,
      maxExpansions: 1_000,
    });
    for (const cell of [
      { x: 0, y: 0 },
      { x: 2, y: 4 },
      { x: 6, y: 4 },
      { x: 4, y: 2 },
    ]) {
      expect(rra.distance(cell)).toBe(lookupDistance(map, expected, cell));
    }
    const before = rra.expanded;
    expect(rra.distance({ x: 0, y: 0 })).toBe(14);
    expect(rra.expanded).toBe(before);
  });

  it("CA* と HCA* が Swap Conflict を妥当な経路で解く", async () => {
    const scenario = buildPreset("swap-conflict", 1);
    for (const id of ["cooperative-astar", "hca-star"] as const) {
      const { result, events } = await solve(id, scenario);
      expectValidSolved(scenario, result);
      expect(events.some((event) => event.type === "reserve")).toBe(true);
      if (id === "hca-star") {
        expect(
          events.some(
            (event) =>
              event.type === "expand-node" &&
              typeof event.state === "object" &&
              event.state !== null &&
              "phase" in event.state &&
              event.state.phase === "abstract-rra",
          ),
        ).toBe(true);
      }
    }
  });
});

describe("Prioritized Planning の限界", () => {
  it("解が存在しても中央退避所 + 固定順では失敗する", async () => {
    const scenario = centralRecessScenario();
    const oracle = jointStateBfs(scenario, 20);
    expect(oracle.solved).toBe(true);
    const { result } = await solve("prioritized-planning", scenario);
    expect(result.outcome).toBe("no-solution");
    expect(result.failureReason).toBe("priority-order");
  });

  it("priorityOrder option を検証する", async () => {
    const scenario = buildPreset("swap-conflict", 1);
    const invalid = await solve("prioritized-planning", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { priorityOrder: ["a1", "missing"] },
    });
    expect(invalid.result.outcome).toBe("error");
    expect(invalid.result.error?.code).toBe("invalid-scenario");
  });
});

describe("SIPP wrapper / WHCA*", () => {
  it("SIPP wrapper が予約を safe interval 化して MAPF 解を返す", async () => {
    const scenario = buildPreset("swap-conflict", 1);
    const { result, events } = await solve("sipp", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
    });
    expectValidSolved(scenario, result);
    expect(events.some((event) => event.type === "discover-safe-interval")).toBe(true);
    expect(result.warnings?.some((warning) => warning.code === "simplified-behavior")).toBe(true);
  });

  it("WHCA* が複数 window を再計画し、衝突なしで完了する", async () => {
    const scenario: Scenario = {
      ...singleAgentScenario(),
      map: createEmptyMap(9, 3),
      agents: [
        { id: "a1", start: { x: 0, y: 0 }, goal: { x: 8, y: 0 } },
        { id: "a2", start: { x: 8, y: 2 }, goal: { x: 0, y: 2 } },
      ],
    };
    const { result, events } = await solve("whca-star", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { windowSize: 4, replanInterval: 2 },
    });
    expectValidSolved(scenario, result);
    expect(result.metrics.replans).toBeGreaterThan(scenario.agents.length);
    expect(events.filter((event) => event.type === "replan").length).toBeGreaterThan(1);
    expect(events.some((event) => event.type === "move")).toBe(true);
  });

  it("WHCA* の window option を範囲検査する", async () => {
    const invalid = await solve("whca-star", singleAgentScenario(), {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { windowSize: 1 },
    });
    expect(invalid.result.outcome).toBe("error");
    expect(invalid.result.error?.code).toBe("invalid-scenario");
  });
});

describe("共通の停止性・trace・決定性", () => {
  it("同じ seed と入力なら6 Solverの経路が一致する", async () => {
    for (const id of BATCH_1_IDS) {
      const scenario =
        id === "space-time-astar" ? singleAgentScenario() : buildPreset("swap-conflict", 3);
      const options =
        id === "whca-star"
          ? { ...DEFAULT_SOLVER_OPTIONS, extra: { windowSize: 8, replanInterval: 4 } }
          : DEFAULT_SOLVER_OPTIONS;
      const a = await solve(id, scenario, options);
      const b = await solve(id, scenario, options);
      expect(a.result.outcome).toBe(b.result.outcome);
      expect(a.result.paths).toEqual(b.result.paths);
    }
  });

  it("trace 上限と node 上限を守る", async () => {
    const trace = await solve("cooperative-astar", buildPreset("open-grid", 1), {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "verbose",
      maxTraceEvents: 3,
    });
    expect(trace.result.trace).toHaveLength(3);
    expect(trace.result.warnings?.some((warning) => warning.code === "trace-truncated")).toBe(true);

    const limited = await solve("hca-star", buildPreset("open-grid", 1), {
      ...DEFAULT_SOLVER_OPTIONS,
      maxExpansions: 1,
    });
    expect(limited.result.outcome).toBe("node-limit");
    expect(limited.result.metrics.expandedNodes).toBeLessThanOrEqual(1);
  });

  it("6 Solver が timeout、AbortSignal、入力サイズ guard を返り値へ反映する", async () => {
    for (const id of BATCH_1_IDS) {
      const scenario =
        id === "space-time-astar" ? singleAgentScenario() : buildPreset("swap-conflict", 1);
      const solver = getSolver(id)!;
      const controller = new AbortController();
      controller.abort();
      const abortedContext = createRecordingContext(scenario.seed, controller.signal).context;
      const aborted = await solver.solve(scenario, DEFAULT_SOLVER_OPTIONS, abortedContext);
      expect(aborted.outcome, id).toBe("aborted");

      const timeoutContext = createRecordingContext(scenario.seed).context;
      const timedOut = await solver.solve(
        scenario,
        { ...DEFAULT_SOLVER_OPTIONS, timeoutMs: 0 },
        timeoutContext,
      );
      expect(timedOut.outcome, id).toBe("timeout");

      const guardedContext = createRecordingContext(scenario.seed).context;
      const guarded = await solver.solve(
        scenario,
        { ...DEFAULT_SOLVER_OPTIONS, maxAgents: 0 },
        guardedContext,
      );
      expect(guarded.outcome, id).toBe("error");
      expect(guarded.failureReason, id).toBe("limit-exceeded");
      expect(
        guarded.warnings?.some((warning) => warning.code === "input-too-large"),
        id,
      ).toBe(true);
    }
  });
});
