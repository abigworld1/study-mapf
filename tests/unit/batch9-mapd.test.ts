import { describe, expect, it } from "vitest";
import { PRESETS, buildPreset, scenarioFromJson, scenarioToJson } from "@/lib/model/scenario";
import { DEFAULT_SOLVER_OPTIONS, type Scenario } from "@/lib/model/types";
import { detectConflicts } from "@/lib/model/conflicts";
import { createRecordingContext } from "@/solvers/context";
import { getSolver, solversFor } from "@/solvers/registry";

async function solve(
  id: string,
  preset: string,
): Promise<Awaited<ReturnType<NonNullable<ReturnType<typeof getSolver>>["solve"]>>> {
  const scenario = buildPreset(preset, 1);
  const solver = getSolver(id)!;
  const recording = createRecordingContext(1);
  return solver.solve(scenario, { ...DEFAULT_SOLVER_OPTIONS, horizon: 180 }, recording.context);
}

async function solveWithOptions(id: string, preset: string, extra?: Record<string, unknown>) {
  const scenario = buildPreset(preset, 1);
  const solver = getSolver(id)!;
  const recording = createRecordingContext(1);
  return solver.solve(
    scenario,
    { ...DEFAULT_SOLVER_OPTIONS, horizon: 180, ...(extra ? { extra } : {}) },
    recording.context,
  );
}

async function solveScenario(id: string, scenario: Scenario) {
  const solver = getSolver(id)!;
  const recording = createRecordingContext(1);
  return solver.solve(scenario, { ...DEFAULT_SOLVER_OPTIONS, horizon: 180 }, recording.context);
}

describe("Batch 9 MAPD", () => {
  it("LNS-PBS と LNS-wPBS は小さい窓で異なる結果になる", async () => {
    const pbs = await solveWithOptions("lns-pbs", "mapd-well-formed");
    const wpbs = await solveWithOptions("lns-wpbs", "mapd-well-formed", { windowSize: 2 });
    expect(pbs.outcome).toBe("solved");
    expect(wpbs.outcome).toBe("timeout");
    expect(wpbs.conflicts).toEqual([]);
    expect(wpbs.metrics.pendingTasks).toBeGreaterThan(0);
    expect(JSON.stringify(wpbs.paths)).not.toBe(JSON.stringify(pbs.paths));
  });

  it("wPBS の窓幅は goal 探索の上限ではない", async () => {
    const result = await solveWithOptions("lns-wpbs", "mapd-multi-goal", { windowSize: 2 });
    expect(result.outcome).toBe("solved");
    expect(result.metrics.pendingTasks).toBe(0);
    expect(result.conflicts).toEqual([]);
  });
  it("sequence solvers are registered for MAPD", () => {
    const scenario = buildPreset("mapd-well-formed", 1);
    const ids = solversFor("mapd", scenario).map((solver) => solver.metadata.id);
    expect(ids).toEqual(expect.arrayContaining(["lns-pbs", "lns-wpbs", "rmca"]));
  });

  it.each(["lns-pbs", "lns-wpbs", "rmca"])(
    "%s solves a multi-goal task without conflicts",
    async (id) => {
      const result = await solve(id, "mapd-multi-goal");
      expect(result.outcome).toBe("solved");
      expect(result.metrics.pendingTasks).toBe(0);
      expect(detectConflicts(result.paths, buildPreset("mapd-multi-goal", 1).rules)).toEqual([]);
    },
  );

  it.each(["lns-pbs", "lns-wpbs", "rmca"])(
    "%s は multi-goal の追加 goal を実際に走査する",
    async (id) => {
      const multi = buildPreset("mapd-multi-goal", 1);
      const single: Scenario = {
        ...multi,
        tasks: multi.tasks!.map((task) => ({ ...task, goals: undefined })),
      };
      const [multiResult, singleResult] = await Promise.all([
        solveScenario(id, multi),
        solveScenario(id, single),
      ]);
      expect(multiResult.outcome).toBe("solved");
      expect(singleResult.outcome).toBe("solved");
      expect(multiResult.metrics.averageServiceTime).toBeGreaterThan(
        singleResult.metrics.averageServiceTime!,
      );
      expect(multiResult.conflicts).toEqual([]);
    },
  );

  it("LNS 系は評価軸を average service time として返す", async () => {
    await expect(solve("lns-pbs", "mapd-well-formed")).resolves.toMatchObject({
      objective: "average-service-time",
    });
    await expect(solve("lns-wpbs", "mapd-well-formed")).resolves.toMatchObject({
      objective: "average-service-time",
    });
  });

  it("RMCA exposes TTD separately from service time", async () => {
    const result = await solve("rmca", "mapd-capacity");
    expect(result.outcome).toBe("solved");
    expect(result.objective).toBe("total-travel-delay");
    expect(result.metrics.totalTravelDelay).toBeDefined();
    expect(result.metrics.averageServiceTime).toBeDefined();
  });

  it("RMCA capacity 1 and capacity 2 produce different plans", async () => {
    const base = buildPreset("mapd-capacity", 1);
    const capacityOne: Scenario = {
      ...base,
      agents: base.agents.map((agent) => ({ ...agent, capacity: 1 })),
    };
    const solver = getSolver("rmca")!;
    const first = createRecordingContext(1);
    const second = createRecordingContext(1);
    const [one, two] = await Promise.all([
      solver.solve(capacityOne, { ...DEFAULT_SOLVER_OPTIONS, horizon: 180 }, first.context),
      solver.solve(base, { ...DEFAULT_SOLVER_OPTIONS, horizon: 180 }, second.context),
    ]);
    expect(one.outcome).toBe("solved");
    expect(two.outcome).toBe("solved");
    expect(one.metrics.sumOfCosts).not.toBe(two.metrics.sumOfCosts);
  });

  it("capacity and goals survive JSON round trip", () => {
    const scenario = buildPreset("mapd-capacity", 1);
    const restored = scenarioFromJson(JSON.parse(JSON.stringify(scenarioToJson(scenario))));
    expect(restored.agents[0]!.capacity).toBe(2);
    expect(restored.tasks![0]!.goals).toBeUndefined();
    const multi = scenarioFromJson(
      JSON.parse(JSON.stringify(scenarioToJson(buildPreset("mapd-multi-goal", 1)))),
    );
    expect(multi.tasks![0]!.goals).toHaveLength(2);
  });

  it("every supported MAPD solver leaves no conflicts when solved", async () => {
    const mapdPresets = PRESETS.filter(
      (preset) => preset.id.startsWith("mapd-") || preset.id === "mapd-multi-goal",
    );
    for (const preset of mapdPresets) {
      const scenario = buildPreset(preset.id, 1);
      for (const solver of solversFor("mapd", scenario)) {
        const recording = createRecordingContext(1);
        const result = await solver.solve(
          scenario,
          { ...DEFAULT_SOLVER_OPTIONS, horizon: 220 },
          recording.context,
        );
        if (result.outcome === "solved") {
          expect(result.conflicts, `${preset.id} / ${solver.metadata.id}`).toEqual([]);
        }
      }
    }
  });

  it("legacy solvers are filtered from extended scenarios", () => {
    const scenario: Scenario = buildPreset("mapd-capacity", 1);
    const ids = solversFor("mapd", scenario).map((solver) => solver.metadata.id);
    expect(ids).not.toContain("token-passing");
    expect(ids).toContain("rmca");
  });
});
