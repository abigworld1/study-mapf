import type { Cell, Scenario, SolverOptions, TimedPath } from "@/lib/model/types.js";
import { sumOfCosts } from "@/lib/model/conflicts.js";
import { DEFAULT_SOLVER_OPTIONS } from "@/lib/model/types.js";
import { validateScenario } from "@/lib/model/scenario.js";
import { createRecordingContext } from "../context.js";
import { solveCbsVariant } from "../cbs/core.js";

export interface TapfSocOracleResult {
  readonly solved: boolean;
  readonly sumOfCosts: number;
  readonly sumOfCostsCertified: boolean;
  readonly paths: readonly TimedPath[];
}

/**
 * Test-only SOC oracle.  It enumerates the small assignment space and uses the
 * existing optimal CBS low-level.  It is deliberately not registered as a
 * browser Solver.
 */
export async function tapfSocOracle(
  scenario: Scenario,
  maxExtraCost = 8,
): Promise<TapfSocOracleResult> {
  if (scenario.kind !== "tapf" || validateScenario(scenario).length > 0) {
    return { solved: false, sumOfCosts: 0, sumOfCostsCertified: false, paths: [] };
  }
  const model = assignmentModel(scenario);
  if (
    !model ||
    model.allowed.length !== scenario.agents.length ||
    model.targets.length !== scenario.agents.length
  ) {
    return { solved: false, sumOfCosts: 0, sumOfCostsCertified: false, paths: [] };
  }
  const assignments = permutations(model.targets.length).filter((assignment) =>
    assignment.every((target, row) => model.allowed[row]?.[target] === true),
  );
  if (assignments.length === 0 || assignments.length > 5040) {
    return { solved: false, sumOfCosts: 0, sumOfCostsCertified: false, paths: [] };
  }
  const options: SolverOptions = {
    ...DEFAULT_SOLVER_OPTIONS,
    timeoutMs: 5_000,
    maxExpansions: 200_000,
    horizon: Math.max(64, maxExtraCost + 32),
    traceLevel: "off",
  };
  let best: { paths: readonly TimedPath[]; cost: number } | undefined;
  let allFinished = true;
  for (const assignment of assignments) {
    const recording = createRecordingContext(scenario.seed);
    const derived: Scenario = {
      ...scenario,
      kind: "one-shot-mapf",
      teams: undefined,
      assignment: undefined,
      agents: scenario.agents.map((agent, index) => ({
        ...agent,
        goal: model.targets[assignment[index]!]!.cell,
      })),
    };
    const result = await solveCbsVariant(derived, options, recording.context, {
      variant: "cbs",
      lowLevelWeight: 1,
      highLevelWeight: 1,
    });
    if (result.outcome !== "solved") {
      allFinished = false;
      continue;
    }
    const cost = sumOfCosts(result.paths);
    if (!best || cost < best.cost) best = { paths: result.paths, cost };
  }
  if (!best) return { solved: false, sumOfCosts: 0, sumOfCostsCertified: false, paths: [] };
  return {
    solved: true,
    sumOfCosts: best.cost,
    sumOfCostsCertified: allFinished,
    paths: best.paths,
  };
}

interface AssignmentModel {
  readonly targets: readonly { id: string; cell: Cell }[];
  readonly allowed: readonly (readonly boolean[])[];
}

function assignmentModel(scenario: Scenario): AssignmentModel | null {
  if (scenario.assignment) return scenario.assignment;
  if (!scenario.teams) return null;
  const targets = scenario.teams.flatMap((team) =>
    team.goals.map((cell, index) => ({ id: `${team.id}-${index}`, cell })),
  );
  const allowed = scenario.agents.map((agent) => {
    const team = scenario.teams!.find((candidate) => candidate.agentIds.includes(agent.id));
    return targets.map((target) => target.id.startsWith(`${team?.id}-`));
  });
  return { targets, allowed };
}

function permutations(size: number): number[][] {
  if (size === 0) return [[]];
  const out: number[][] = [];
  for (let first = 0; first < size; first += 1) {
    for (const tail of permutations(size - 1)) {
      out.push([first, ...tail.map((value) => (value >= first ? value + 1 : value))]);
    }
  }
  return out;
}
