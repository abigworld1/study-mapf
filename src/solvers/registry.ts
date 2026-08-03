import type { MapfSolver, ProblemKind, Scenario, SolverMetadata } from "@/lib/model/types.js";
import { aStarSolver, bfsSolver } from "./basic/individual-search.js";
import {
  prioritizedPlanningSolver,
  spaceTimeAStarSolver,
} from "./prioritized/prioritized-planning.js";
import { cooperativeAStarSolver, hcaStarSolver } from "./prioritized/cooperative-astar.js";
import { sippSolver } from "./prioritized/sipp-solver.js";
import { whcaStarSolver } from "./prioritized/whca-star.js";
import { bcbsSolver, cbsSolver, ecbsSolver, eecbsSolver, icbsSolver } from "./cbs/solvers.js";
import { pbsSolver } from "./pbs/pbs.js";
import { pibtSolver } from "./pibt/pibt.js";
import { winPibtSolver } from "./pibt/winpibt.js";
import { ictsSolver } from "./joint/icts.js";
import { mstarSolver } from "./joint/mstar.js";
import { pushAndRotateSolver, pushAndSwapSolver } from "./push/solvers.js";
import { lacamSolver, lacamStarSolver } from "./lacam/solvers.js";
import { mapfLnsSolver, mapfLns2Solver, rhcrSolver } from "./lns/solvers.js";
import { tapfBaselineSolver } from "./tapf/baseline.js";
import { cbmSolver } from "./tapf/cbm.js";
import { cbsTaSolver } from "./tapf/cbs-ta.js";
import { minCostMaxFlowSolver } from "./tapf/mcmf-solver.js";
import { mapdGreedySolver } from "./mapd/greedy.js";
import { centralSolver, tokenPassingSolver, tptsSolver } from "./mapd/solvers.js";
import { lnsPbsSolver, lnsWpbsSolver, rmcaSolver } from "./mapd/batch9-solvers.js";

/**
 * Solver の登録所。
 *
 * ★ Codex が新しいアルゴリズムを追加する入口はここ。
 *   1. src/solvers/<category>/<name>.ts に MapfSolver を実装する
 *   2. metadata.id を docs/sources/algorithms.yaml の algorithm-id と一致させる
 *   3. 下の SOLVERS へ追加する
 *   これだけでシミュレータの選択肢、アルゴリズムページのバッジ、
 *   比較表の「シミュレータ対応」列が自動で更新される。
 *
 *   実装していないアルゴリズムをここへ追加してはならない。
 *   選択肢に出ることが「動く」という意味になるため。
 *   解説だけのものは algorithms.yaml 側の implementation_status で表現する。
 *
 * 詳細は ALGORITHM_IMPLEMENTATION_GUIDE.md。
 */
const SOLVERS: readonly MapfSolver[] = [
  bfsSolver,
  aStarSolver,
  spaceTimeAStarSolver,
  sippSolver,
  prioritizedPlanningSolver,
  cooperativeAStarSolver,
  hcaStarSolver,
  whcaStarSolver,
  cbsSolver,
  bcbsSolver,
  ecbsSolver,
  icbsSolver,
  eecbsSolver,
  pbsSolver,
  pibtSolver,
  winPibtSolver,
  ictsSolver,
  mstarSolver,
  pushAndSwapSolver,
  pushAndRotateSolver,
  lacamSolver,
  lacamStarSolver,
  mapfLnsSolver,
  mapfLns2Solver,
  rhcrSolver,
  tapfBaselineSolver,
  cbmSolver,
  cbsTaSolver,
  minCostMaxFlowSolver,
  mapdGreedySolver,
  tokenPassingSolver,
  tptsSolver,
  centralSolver,
  lnsPbsSolver,
  lnsWpbsSolver,
  rmcaSolver,
];

const byId = new Map(SOLVERS.map((s) => [s.metadata.id, s]));

export function listSolvers(): readonly MapfSolver[] {
  return SOLVERS;
}

export function listSolverMetadata(): readonly SolverMetadata[] {
  return SOLVERS.map((s) => s.metadata);
}

export function getSolver(id: string): MapfSolver | undefined {
  return byId.get(id);
}

export function hasSolver(id: string): boolean {
  return byId.has(id);
}

export function solversFor(kind: ProblemKind, scenario?: Scenario): readonly MapfSolver[] {
  return SOLVERS.filter(
    (s) =>
      s.metadata.supports.includes(kind) &&
      (scenario === undefined || s.canSolve === undefined || s.canSolve(scenario)),
  );
}

export function listSolverMetadataFor(scenario: Scenario): readonly SolverMetadata[] {
  return solversFor(scenario.kind, scenario).map((s) => s.metadata);
}

/** algorithms.yaml の algorithm-id のうち、実際に動く実装があるもの。 */
export const RUNNABLE_ALGORITHM_IDS: readonly string[] = SOLVERS.map((s) => s.metadata.id);
