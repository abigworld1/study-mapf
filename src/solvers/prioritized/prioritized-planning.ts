import { createSequentialSolver } from "./sequential-planning.js";

export const spaceTimeAStarSolver = createSequentialSolver(
  {
    id: "space-time-astar",
    displayName: "時空間 A*",
    originalName: "Space-Time A*",
    category: "space-time-search",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: ["allowDiagonal"],
    basedOnPaperIds: ["cooperative-pathfinding-2005"],
    implementationNote:
      "原論文どおり (cell,time) を探索する低レベル Solver。CA* と混同しないよう単一エージェントのシナリオだけを受理する。edge-swap / following はサイト共通ルールへの拡張。",
  },
  {
    planner: "space-time",
    heuristic: "manhattan",
    requireSingleAgent: true,
  },
);

export const prioritizedPlanningSolver = createSequentialSolver(
  {
    id: "prioritized-planning",
    displayName: "優先順位付き計画（固定順）",
    originalName: "Prioritized Planning",
    category: "prioritized-planning",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: ["allowDiagonal"],
    basedOnPaperIds: ["cooperative-pathfinding-2005", "pbs-aaai-2019"],
    implementationNote:
      "既定は scenario.agents の固定順。extra.priorityOrder で全順序を明示できる。優先順位や同コスト経路によっては、解が存在しても失敗する。PBS のような順序探索は行わない。",
  },
  {
    planner: "space-time",
    heuristic: "true-distance",
    allowPriorityOrderOption: true,
  },
);
