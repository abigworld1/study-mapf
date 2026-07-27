import { createSequentialSolver } from "./sequential-planning.js";

export const sippSolver = createSequentialSolver(
  {
    id: "sipp",
    displayName: "SIPP",
    originalName: "Safe Interval Path Planning",
    category: "space-time-search",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: ["allowDiagonal"],
    basedOnPaperIds: ["sipp-icra-2011"],
    implementationNote:
      "SIPP の状態 (cell,safe interval) と最早到着時刻を原論文どおり実装。MAPF で実行するため、Solver wrapper は入力順の prioritized planning として各 agent を SIPP で計画する。",
  },
  {
    planner: "sipp",
    heuristic: "true-distance",
    warnings: [
      {
        code: "simplified-behavior",
        message:
          "原論文の SIPP は既知の動的障害物を避ける単一ロボット手法です。この Solver は MAPF 用に、先に計画した agent を動的障害物とする固定順 wrapper を使用します。",
      },
    ],
  },
);
