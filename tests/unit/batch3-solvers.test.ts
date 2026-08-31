import { describe, expect, it } from "vitest";
import type { Scenario, SolverOptions, SolverResult } from "@/lib/model/types";
import { DEFAULT_RULES, DEFAULT_SOLVER_OPTIONS } from "@/lib/model/types";
import { createEmptyMap, withBlocked } from "@/lib/model/grid";
import { buildPreset } from "@/lib/model/scenario";
import { createRecordingContext } from "@/solvers/context";
import { getSolver } from "@/solvers/registry";
import { jointStateBfs } from "@/solvers/reference/joint-state";
import { checkPaths } from "../helpers/check-paths";

const BATCH_3_IDS = ["pbs", "pibt", "winpibt"] as const;

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

function fullRotation(): Scenario {
  return {
    id: "full-rotation",
    name: "fully occupied 2x2 rotation",
    kind: "one-shot-mapf",
    map: createEmptyMap(2, 2),
    agents: [
      { id: "a1", start: { x: 0, y: 0 }, goal: { x: 1, y: 0 } },
      { id: "a2", start: { x: 1, y: 0 }, goal: { x: 1, y: 1 } },
      { id: "a3", start: { x: 1, y: 1 }, goal: { x: 0, y: 1 } },
      { id: "a4", start: { x: 0, y: 1 }, goal: { x: 0, y: 0 } },
    ],
    rules: DEFAULT_RULES,
    seed: 4,
  };
}

function centralRecess(recessX = 2): Scenario {
  let map = createEmptyMap(5, 3);
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 5; x += 1) map = withBlocked(map, { x, y }, true);
  }
  for (let x = 0; x < 5; x += 1) map = withBlocked(map, { x, y: 1 }, false);
  map = withBlocked(map, { x: recessX, y: 0 }, false);
  return {
    id: "central-recess-batch3",
    name: "central recess",
    kind: "one-shot-mapf",
    map,
    agents: [
      { id: "a1", start: { x: 0, y: 1 }, goal: { x: 4, y: 1 } },
      { id: "a2", start: { x: 4, y: 1 }, goal: { x: 0, y: 1 } },
    ],
    rules: DEFAULT_RULES,
    seed: 3,
  };
}

describe("Batch 3 registry と metadata", () => {
  it("PBS / PIBT / winPIBT を実装状態に合わせて登録する", () => {
    for (const id of BATCH_3_IDS) {
      const solver = getSolver(id);
      expect(solver).toBeDefined();
      expect(solver!.metadata.status).toBe("runnable");
      expect(["paper-faithful", "reference-validated"]).toContain(solver!.metadata.fidelity);
      expect(solver!.metadata.unsupportedRules).toContain("allowDiagonal");
      /*
        ★ PIBT / winPIBT は優先度継承で「押し出した相手のセルへ同じ step で入る」
          ことが中核なので、following 禁止には対応しない。PBS は予約表の側で
          避けられるので対応する。
      */
      if (id === "pbs") expect(solver!.metadata.unsupportedRules).not.toContain("forbidFollowing");
      else expect(solver!.metadata.unsupportedRules).toContain("forbidFollowing");
      expect(solver!.metadata.unsupportedRules).toContain("goalBehavior");
    }
  });
});

describe("PBS", () => {
  it("author-maintained PBS と同じ 3x2 fixture で SOC / makespan が一致する", async () => {
    const scenario: Scenario = {
      id: "pbs-reference-3x2",
      name: "PBS public implementation comparison",
      kind: "one-shot-mapf",
      map: createEmptyMap(3, 2),
      agents: [
        { id: "a1", start: { x: 0, y: 0 }, goal: { x: 2, y: 0 } },
        { id: "a2", start: { x: 2, y: 0 }, goal: { x: 0, y: 0 } },
      ],
      rules: DEFAULT_RULES,
      seed: 1,
    };
    const { result } = await solve("pbs", scenario);
    expectValid(scenario, result);
    // `.references/pbs` d7b91fa5, --sipp=false: Succeed, SOC=6, makespan=4。
    expect(result.metrics.sumOfCosts).toBe(6);
    expect(result.metrics.makespan).toBe(4);
  });

  it("priority-tree を分岐して swap + detour を解く", async () => {
    const scenario = buildPreset("swap-conflict", 2);
    const { result, events } = await solve("pbs", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
    });
    expectValid(scenario, result);
    for (const type of [
      "detect-conflict",
      "set-priority",
      "update-priority-dag",
      "replan-lower-priority-agent",
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
    expect(result.metrics.replans).toBeGreaterThan(0);
    expect(result.metrics.conflictsDetected).toBeGreaterThan(0);
  });

  it("固定順が失敗する off-center recess を sibling priority branch で解く", async () => {
    const scenario = centralRecess(1);
    expect(jointStateBfs(scenario, 20).solved).toBe(true);
    const fixed = await solve("prioritized-planning", scenario);
    expect(fixed.result.outcome).toBe("no-solution");
    expect(fixed.result.failureReason).toBe("priority-order");

    const pbs = await solve("pbs", scenario);
    expectValid(scenario, pbs.result);
    expect(pbs.result.metrics.sumOfCosts).toBe(11);
  });

  it("initial partial order の cycle と未知 ID を拒否する", async () => {
    const scenario = buildPreset("swap-conflict", 1);
    const cycle = await solve("pbs", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: {
        initialPriority: [
          { higher: "a1", lower: "a2" },
          { higher: "a2", lower: "a1" },
        ],
      },
    });
    expect(cycle.result.outcome).toBe("error");
    expect(cycle.result.error?.code).toBe("invalid-scenario");

    const unknown = await solve("pbs", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { initialPriority: [{ higher: "a1", lower: "missing" }] },
    });
    expect(unknown.result.outcome).toBe("error");
    expect(unknown.result.error?.code).toBe("invalid-scenario");
  });

  it("prioritized planning の不完全例で、PBS も保証を過大主張しない", async () => {
    const scenario = centralRecess();
    expect(jointStateBfs(scenario, 20).solved).toBe(true);
    const { result } = await solve("pbs", scenario);
    expect(result.outcome).toBe("no-solution");
    expect(result.failureReason).toBe("search-exhausted");
  });
});

describe("PIBT", () => {
  it("満杯の simple cycle を priority inheritance で rotation する", async () => {
    const scenario = fullRotation();
    const { result, events } = await solve("pibt", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
      extra: { maxTimesteps: 20 },
    });
    expectValid(scenario, result);
    expect(result.metrics.makespan).toBe(1);
    expect(events.some((event) => event.type === "priority-order")).toBe(true);
    expect(events.some((event) => event.type === "candidate-evaluation")).toBe(true);
    expect(events.some((event) => event.type === "inherit-priority")).toBe(true);
    expect(events.some((event) => event.type === "move")).toBe(true);
  });

  it("graph condition 外では horizon failure を解不存在と混同しない", async () => {
    const scenario: Scenario = {
      id: "blocked-swap",
      name: "blocked swap",
      kind: "one-shot-mapf",
      map: createEmptyMap(2, 1),
      agents: [
        { id: "a1", start: { x: 0, y: 0 }, goal: { x: 1, y: 0 } },
        { id: "a2", start: { x: 1, y: 0 }, goal: { x: 0, y: 0 } },
      ],
      rules: DEFAULT_RULES,
      seed: 1,
    };
    const { result, events } = await solve("pibt", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
      extra: { maxTimesteps: 4 },
    });
    expect(result.outcome).toBe("no-solution");
    expect(result.failureReason).toBe("search-exhausted");
    expect(result.warnings?.some((warning) => warning.code === "simplified-behavior")).toBe(true);
    expect(events.some((event) => event.type === "backtrack")).toBe(true);
    expect(result.trace?.some((event) => event.type === "backtrack")).toBe(true);
  });
});

describe("winPIBT", () => {
  it("window 1 で PIBT の 1-step rotation semantics を再現する", async () => {
    const scenario = fullRotation();
    const pibt = await solve("pibt", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { maxTimesteps: 20 },
    });
    const win = await solve("winpibt", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { windowSize: 1, maxTimesteps: 20 },
    });
    expectValid(scenario, win.result);
    expect(win.result.paths).toEqual(pibt.result.paths);
  });

  it("window > 1 で provisional paths を確保して有効解を返す", async () => {
    const scenario = fullRotation();
    const { result, events } = await solve("winpibt", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
      extra: { windowSize: 3, maxTimesteps: 20 },
    });
    expectValid(scenario, result);
    expect(events.some((event) => event.type === "reserve")).toBe(true);
    expect(events.some((event) => event.type === "candidate-evaluation")).toBe(true);
    expect(events.some((event) => event.type === "move")).toBe(true);
  });

  it("window option を範囲検査する", async () => {
    const { result } = await solve("winpibt", fullRotation(), {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { windowSize: 0 },
    });
    expect(result.outcome).toBe("error");
    expect(result.error?.code).toBe("invalid-scenario");
  });
});

describe("Batch 3 共通の停止性・決定性・rule guard", () => {
  it("同じ seed と入力なら 3 Solver の経路が一致する", async () => {
    for (const id of BATCH_3_IDS) {
      const scenario = id === "pbs" ? buildPreset("swap-conflict", 7) : fullRotation();
      const options =
        id === "winpibt"
          ? { ...DEFAULT_SOLVER_OPTIONS, extra: { windowSize: 3, maxTimesteps: 20 } }
          : { ...DEFAULT_SOLVER_OPTIONS, extra: { maxTimesteps: 20 } };
      const first = await solve(id, scenario, options);
      const second = await solve(id, scenario, options);
      expect(first.result.outcome).toBe(second.result.outcome);
      expect(first.result.paths).toEqual(second.result.paths);
    }
  });

  it("node limit、timeout、AbortSignal、trace limit を守る", async () => {
    const scenario = buildPreset("swap-conflict", 1);
    const limited = await solve("pbs", scenario, {
      ...DEFAULT_SOLVER_OPTIONS,
      maxExpansions: 1,
    });
    expect(limited.result.outcome).toBe("node-limit");
    expect(limited.result.metrics.expandedNodes).toBe(1);

    const timedOut = await solve("pibt", fullRotation(), {
      ...DEFAULT_SOLVER_OPTIONS,
      timeoutMs: 0,
    });
    expect(timedOut.result.outcome).toBe("timeout");

    const solver = getSolver("winpibt")!;
    const controller = new AbortController();
    controller.abort();
    const { context } = createRecordingContext(1, controller.signal);
    const aborted = await solver.solve(fullRotation(), DEFAULT_SOLVER_OPTIONS, context);
    expect(aborted.outcome).toBe("aborted");

    const traced = await solve("pibt", fullRotation(), {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "verbose",
      maxTraceEvents: 1,
      extra: { maxTimesteps: 20 },
    });
    expectValid(fullRotation(), traced.result);
    expect(traced.result.trace).toHaveLength(1);
    expect(traced.result.warnings?.some((warning) => warning.code === "trace-truncated")).toBe(
      true,
    );
  });

  it("未対応 rule と入力 guard を構造化して返す", async () => {
    const following = await solve("pibt", {
      ...fullRotation(),
      rules: { ...DEFAULT_RULES, forbidFollowing: true },
    });
    expect(following.result.outcome).toBe("error");
    expect(following.result.error?.code).toBe("unsupported-rules");

    const guarded = await solve("winpibt", fullRotation(), {
      ...DEFAULT_SOLVER_OPTIONS,
      maxAgents: 1,
    });
    expect(guarded.result.outcome).toBe("error");
    expect(guarded.result.failureReason).toBe("limit-exceeded");
  });
});
