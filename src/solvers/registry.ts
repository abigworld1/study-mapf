import type { MapfSolver, ProblemKind, SolverMetadata } from "@/lib/model/types.js";
import { aStarSolver, bfsSolver } from "./basic/individual-search.js";
import {
  prioritizedPlanningSolver,
  spaceTimeAStarSolver,
} from "./prioritized/prioritized-planning.js";

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
  prioritizedPlanningSolver,
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

export function solversFor(kind: ProblemKind): readonly MapfSolver[] {
  return SOLVERS.filter((s) => s.metadata.supports.includes(kind));
}

/** algorithms.yaml の algorithm-id のうち、実際に動く実装があるもの。 */
export const RUNNABLE_ALGORITHM_IDS: readonly string[] = SOLVERS.map((s) => s.metadata.id);
