import type { MapfSolver, SolverResult } from "@/lib/model/types.js";
import { runMapdLoop } from "./loop.js";
import {
  createCentralStrategy,
  createTokenPassingStrategy,
  createTptsStrategy,
} from "./strategies.js";

export function canSolveLegacyMapd(
  scenario: Parameters<NonNullable<MapfSolver["canSolve"]>>[0],
): boolean {
  return (
    scenario.kind === "mapd" &&
    (scenario.tasks?.length ?? 0) > 0 &&
    !scenario.agents.some((agent) => (agent.capacity ?? 1) > 1) &&
    !scenario.tasks?.some((task) => (task.goals?.length ?? 0) > 0)
  );
}

export const tokenPassingSolver: MapfSolver = {
  metadata: {
    id: "token-passing",
    displayName: "TP (Token Passing)",
    originalName: "Token Passing",
    category: "mapd",
    supports: ["mapd"],
    status: "runnable",
    fidelity: "educational",
    basedOnPaperIds: ["mapd-tp-tpts-central-2017", "mla-star-icaps-2019"],
    implementationNote:
      "明示的 token、Path1 / Path2、well-formed の endpoint 規律を実装します。低レベルは MLA* に置き換えた TP+MLA* の教育用実装です。",
  },
  canSolve: canSolveLegacyMapd,
  async solve(scenario, options, context): Promise<SolverResult> {
    return runMapdLoop(scenario, options, context, createTokenPassingStrategy(options, context));
  },
};

export const tptsSolver: MapfSolver = {
  metadata: {
    id: "tpts",
    displayName: "TPTS (Token Passing with Task Swaps)",
    originalName: "Token Passing with Task Swaps",
    category: "mapd",
    supports: ["mapd"],
    status: "runnable",
    fidelity: "educational",
    basedOnPaperIds: ["mapd-tp-tpts-central-2017", "mla-star-icaps-2019"],
    implementationNote:
      "TP の token / Path1 / Path2 を共有します。未 pickup の task なら前 timestep の carrying 中でも、pickup までの決定的な距離が短い agent が assign で奪えます。loop が swap-task を出し、old owner は同じ step に再計画します。",
  },
  canSolve: canSolveLegacyMapd,
  async solve(scenario, options, context): Promise<SolverResult> {
    return runMapdLoop(scenario, options, context, createTptsStrategy(options, context));
  },
};

export const centralSolver: MapfSolver = {
  metadata: {
    id: "central",
    displayName: "CENTRAL",
    originalName: "CENTRAL",
    category: "mapd",
    supports: ["mapd"],
    status: "runnable",
    fidelity: "educational",
    basedOnPaperIds: ["mapd-tp-tpts-central-2017", "mla-star-icaps-2019"],
    implementationNote:
      "Hungarian による中央割当と MLA* の token 計画を組み合わせた strawman です。論文の二段 CBS はブラウザ版では未実装で、解決性・最適性を保証しません。",
  },
  canSolve: canSolveLegacyMapd,
  async solve(scenario, options, context): Promise<SolverResult> {
    return runMapdLoop(scenario, options, context, createCentralStrategy(options, context));
  },
};
