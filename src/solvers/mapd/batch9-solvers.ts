import type { MapfSolver, SolverResult } from "@/lib/model/types.js";
import { runMapdLoop } from "./loop.js";
import { createLnsPbsStrategy, createLnsWpbsStrategy, createRmcaStrategy } from "./batch9.js";

function canSolveMapd(scenario: Parameters<NonNullable<MapfSolver["canSolve"]>>[0]): boolean {
  return scenario.kind === "mapd" && (scenario.tasks?.length ?? 0) > 0;
}

export const lnsPbsSolver: MapfSolver = {
  metadata: {
    id: "lns-pbs",
    displayName: "LNS-PBS",
    originalName: "Large Neighborhood Search with Priority-Based Search",
    category: "mapd",
    supports: ["mapd"],
    status: "runnable",
    fidelity: "educational",
    basedOnPaperIds: ["mg-mapd-iros-2022"],
    implementationNote:
      "MG-MAPD の task sequence と multi-goal を扱う決定的な教育実装。LNS の全 anytime 近傍と dummy-path による完全性証明の実装ではなく、順序付き時空間 A* で PBS の役割を可視化します。",
  },
  canSolve: canSolveMapd,
  async solve(scenario, options, context): Promise<SolverResult> {
    const result = await runMapdLoop(
      scenario,
      options,
      context,
      createLnsPbsStrategy(options, context),
    );
    return { ...result, objective: "average-service-time" };
  },
};

export const lnsWpbsSolver: MapfSolver = {
  metadata: {
    id: "lns-wpbs",
    displayName: "LNS-wPBS",
    originalName: "Windowed Priority-Based Search with LNS",
    category: "mapd",
    supports: ["mapd"],
    status: "runnable",
    fidelity: "educational",
    basedOnPaperIds: ["mg-mapd-iros-2022"],
    implementationNote:
      "LNS-PBS の task sequence planner に wPBS の rolling window を接続した教育実装。extra.windowSize（既定 w=10）ごとに再計画し、衝突解消範囲を窓内へ限定するため、論文どおり完全性を保証しません。",
  },
  canSolve: canSolveMapd,
  async solve(scenario, options, context): Promise<SolverResult> {
    const result = await runMapdLoop(
      scenario,
      options,
      context,
      createLnsWpbsStrategy(options, context),
    );
    const warning = {
      code: "simplified-behavior" as const,
      message:
        "LNS-wPBS は windowed PBS を実装した教育用骨格です。窓による shortsightedness のため、論文が明記するように完全性の保証はなく、良い service time が保証を意味しません。",
    };
    return {
      ...result,
      objective: "average-service-time",
      warnings: [...(result.warnings ?? []), warning],
    };
  },
};

export const rmcaSolver: MapfSolver = {
  metadata: {
    id: "rmca",
    displayName: "RMCA",
    originalName:
      "Integrated Task Assignment and Path Planning for Capacitated Multi-Agent Pickup and Delivery",
    category: "mapd",
    supports: ["mapd"],
    status: "runnable",
    fidelity: "educational",
    basedOnPaperIds: ["rmca-ral-2021"],
    implementationNote:
      "capacity つき task sequence を regret insertion で作り、実際の path cost を順序付き planner に反映する教育実装。論文の priority heap 全体と優先順位付き探索の完全性は簡略化しています。objective は service time ではなく TTD です。",
  },
  canSolve: canSolveMapd,
  async solve(scenario, options, context): Promise<SolverResult> {
    const result = await runMapdLoop(
      scenario,
      options,
      context,
      createRmcaStrategy(options, context),
    );
    return { ...result, objective: "total-travel-delay" };
  },
};
