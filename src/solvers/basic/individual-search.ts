import type {
  MapfSolver,
  Scenario,
  SolverContext,
  SolverOptions,
  SolverResult,
  TimedPath,
} from "@/lib/model/types.js";
import { spaceTimeAStar } from "../low-level/space-time-astar.js";
import { trueDistanceFrom } from "@/lib/model/grid.js";
import { buildResult, checkAbort, defaultMaxTime, emptyResult } from "../shared.js";
import { checkLimits } from "../limits.js";

/**
 * 各エージェントを他エージェントを無視して独立に計画する解法。
 *
 * ★ これは MAPF を解いていない。
 *   衝突を一切考慮しないので、結果には衝突が残る。
 *   「個別最適な経路を並べるだけでは MAPF にならない」ことを見せるための土台であり、
 *   シミュレータ上でも衝突がそのまま表示される。
 *
 * BFS と A* の違いは、ヒューリスティクスを使うかどうかだけ。
 * 単位コストなので両方とも個別最適な経路を返し、展開ノード数だけが変わる。
 */
function makeIndividualSolver(
  id: "bfs" | "astar",
  displayName: string,
  originalName: string,
  useHeuristic: boolean,
): MapfSolver {
  return {
    metadata: {
      id,
      displayName,
      originalName,
      category: "basic-search",
      supports: ["one-shot-mapf"],
      status: "runnable",
      fidelity: "educational",
      basedOnPaperIds: id === "astar" ? ["astar-1968"] : [],
      implementationNote:
        "各エージェントを独立に計画する。他エージェントとの衝突は解消しない。MAPF の解ではなく、基礎探索の挙動と、衝突が必ず起きることを示すための実装。",
    },

    async solve(
      scenario: Scenario,
      options: SolverOptions,
      context: SolverContext,
    ): Promise<SolverResult> {
      const startedAt = context.now();

      // ★ 探索前に入力の大きさを弾く。ブラウザを固まらせないため。
      const limits = checkLimits(scenario, options);
      if (!limits.ok) return limits.result!;

      const maxTime = defaultMaxTime(scenario);
      const paths: TimedPath[] = [];
      let expanded = 0;

      for (let i = 0; i < scenario.agents.length; i += 1) {
        const agent = scenario.agents[i]!;
        const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
        if (abort !== "ok") return emptyResult(abort, context.now() - startedAt);

        if (!agent.goal) {
          return emptyResult("error", context.now() - startedAt, {
            code: "invalid-scenario",
            message: `${agent.id} に目標が設定されていません`,
          });
        }

        // BFS は「ヒューリスティクス 0 の A*」として実装する。
        // 展開順が幅優先になり、単位コストでは BFS と一致する。
        const heuristic = useHeuristic
          ? trueDistanceFrom(scenario.map, agent.goal)
          : new Float64Array(scenario.map.width * scenario.map.height).fill(0);

        const out = spaceTimeAStar({
          map: scenario.map,
          start: agent.start,
          goal: agent.goal,
          agentId: agent.id,
          rules: scenario.rules,
          maxTime,
          maxExpansions: Math.floor(options.maxExpansions / Math.max(1, scenario.agents.length)),
          heuristic,
          onExpand: (cell, time) => {
            context.emit({ type: "expand-node", agentId: agent.id, state: { cell, time } });
          },
        });

        expanded += out.expanded;
        if (!out.path) {
          return emptyResult(
            out.reason === "max-expansions" ? "node-limit" : "no-solution",
            context.now() - startedAt,
          );
        }
        paths.push(out.path);
        context.emit({
          type: "progress",
          ratio: (i + 1) / scenario.agents.length,
          label: `${agent.id} の経路を計画`,
        });
      }

      const result = buildResult(scenario, paths, context.now() - startedAt, expanded);
      for (const conflict of result.conflicts) {
        context.emit({ type: "detect-conflict", conflict });
      }
      context.emit({ type: "finish", result });
      return result;
    },
  };
}

export const bfsSolver: MapfSolver = makeIndividualSolver(
  "bfs",
  "幅優先探索（各エージェント独立）",
  "BFS",
  false,
);

export const aStarSolver: MapfSolver = makeIndividualSolver(
  "astar",
  "A*（各エージェント独立）",
  "A*",
  true,
);
