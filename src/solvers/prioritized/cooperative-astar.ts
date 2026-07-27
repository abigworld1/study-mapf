import { createSequentialSolver } from "./sequential-planning.js";

export const cooperativeAStarSolver = createSequentialSolver(
  {
    id: "cooperative-astar",
    displayName: "Cooperative A*",
    originalName: "Cooperative A* (CA*)",
    category: "prioritized-planning",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: ["allowDiagonal"],
    basedOnPaperIds: ["cooperative-pathfinding-2005"],
    implementationNote:
      "Silver (2005) の基本形どおり、入力順に Space-Time A* を実行し、Manhattan heuristic と疎な reservation table を使う。edge-swap / following はサイト規則への拡張。",
  },
  {
    planner: "space-time",
    heuristic: "manhattan",
  },
);

export const hcaStarSolver = createSequentialSolver(
  {
    id: "hca-star",
    displayName: "HCA*",
    originalName: "Hierarchical Cooperative A*",
    category: "prioritized-planning",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: ["allowDiagonal"],
    basedOnPaperIds: ["cooperative-pathfinding-2005"],
    implementationNote:
      "CA* の Manhattan heuristic を、Silver (2005) Algorithm 1 の on-demand Reverse Resumable A* による抽象距離へ置き換える。入力順は固定で、公開 pibt2 の distance-first priority は採用しない。",
  },
  {
    planner: "space-time",
    heuristic: "rra",
  },
);
