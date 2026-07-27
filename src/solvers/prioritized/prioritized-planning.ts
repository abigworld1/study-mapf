import type {
  MapfSolver,
  Scenario,
  SolverContext,
  SolverOptions,
  SolverResult,
  TimedPath,
} from "@/lib/model/types.js";
import { SimpleReservationTable } from "@/lib/model/reservation.js";
import { spaceTimeAStar } from "../low-level/space-time-astar.js";
import { trueDistanceFrom } from "@/lib/model/grid.js";
import { buildResult, checkAbort, defaultMaxTime, emptyResult } from "../shared.js";
import { checkLimits } from "../limits.js";

/**
 * 固定優先順位の優先順位付き計画（Prioritized Planning）。
 *
 * エージェントを配列順（= 固定優先順位）に 1 体ずつ時空間 A* で計画し、
 * 計画済みの経路を予約表へ入れて後続の障害物として扱う。
 *
 * ★ 完全ではない。
 *   優先順位の選び方によっては、解ける問題でも失敗する。
 *   これは実装の手抜きではなく手法の性質である
 *   （pbs-aaai-2019 が優先順位付き計画の完全性・最適性の限界を論じている）。
 *   失敗したときは outcome: "no-solution" を返し、UI 側で
 *   「この優先順位では見つからなかった」ことを明示する。
 *
 * ★ これは PBS ではない。PBS は優先順位を固定せず部分順序を探索する。
 */
export const prioritizedPlanningSolver: MapfSolver = {
  metadata: {
    id: "prioritized-planning",
    displayName: "優先順位付き計画（固定順）",
    originalName: "Prioritized Planning",
    category: "prioritized-planning",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "educational",
    basedOnPaperIds: ["cooperative-pathfinding-2005", "pbs-aaai-2019"],
    implementationNote:
      "優先順位はエージェントの並び順に固定している。優先順位の探索は行わない（それは PBS）。完全性は無く、順序によっては解ける問題でも失敗する。",
  },

  async solve(
    scenario: Scenario,
    options: SolverOptions,
    context: SolverContext,
  ): Promise<SolverResult> {
    const startedAt = context.now();

    // ★ 探索前に入力の大きさを弾く。
    const limits = checkLimits(scenario, options);
    if (!limits.ok) return limits.result!;

    const maxTime = defaultMaxTime(scenario);
    const table = new SimpleReservationTable();
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

      // 先に計画したエージェントほど優先度が高い、という関係を可視化へ流す。
      for (let j = 0; j < i; j += 1) {
        context.emit({ type: "set-priority", higher: scenario.agents[j]!.id, lower: agent.id });
      }

      const out = spaceTimeAStar({
        map: scenario.map,
        start: agent.start,
        goal: agent.goal,
        agentId: agent.id,
        rules: scenario.rules,
        reservations: table,
        reservationHorizon: maxTime,
        maxTime,
        maxExpansions: Math.floor(options.maxExpansions / Math.max(1, scenario.agents.length)),
        heuristic: trueDistanceFrom(scenario.map, agent.goal),
        onExpand: (cell, time) => {
          context.emit({ type: "expand-node", agentId: agent.id, state: { cell, time } });
        },
      });

      expanded += out.expanded;

      if (!out.path) {
        // 手法の性質としての失敗。実装の不具合と区別できるよう理由を残す。
        const result: SolverResult = {
          outcome: out.reason === "max-expansions" ? "node-limit" : "no-solution",
          paths,
          metrics: {
            sumOfCosts: 0,
            makespan: 0,
            expandedNodes: expanded,
            runtimeMs: context.now() - startedAt,
          },
          conflicts: [],
          error: {
            code: "internal",
            message: `${agent.id} の経路が見つかりませんでした。固定優先順位では解けない配置の可能性があります（優先順位付き計画は完全ではありません）。`,
          },
        };
        context.emit({ type: "finish", result });
        return result;
      }

      table.reservePath(out.path, maxTime);
      for (const p of out.path.positions) {
        context.emit({ type: "reserve", agentId: agent.id, cell: p.cell, time: p.time });
      }
      paths.push(out.path);
      context.emit({
        type: "progress",
        ratio: (i + 1) / scenario.agents.length,
        label: `${agent.id} を計画（優先度 ${i + 1}）`,
      });
    }

    const result = buildResult(scenario, paths, context.now() - startedAt, expanded);
    context.emit({ type: "finish", result });
    return result;
  },
};

/**
 * 時空間 A* を 1 体だけに適用する解法。
 *
 * 先頭エージェントだけを時空間 A* で計画し、残りは
 * 「他エージェントを無視した個別最適経路」で動く移動障害物として扱う。
 * 低レベル探索が何をしているかを 1 体分だけ取り出して見せるための実装で、
 * 全体としては MAPF を解いていない（残りのエージェント同士は衝突しうる）。
 */
export const spaceTimeAStarSolver: MapfSolver = {
  metadata: {
    id: "space-time-astar",
    displayName: "時空間 A*（1 体のみ回避）",
    originalName: "Space-Time A*",
    category: "space-time-search",
    supports: ["one-shot-mapf"],
    status: "partial",
    fidelity: "educational",
    basedOnPaperIds: ["cooperative-pathfinding-2005"],
    implementationNote:
      "先頭エージェントだけが他を避ける。残りのエージェントは互いを無視して動くため、全体としては MAPF の解にならない。低レベル探索の挙動を 1 体分だけ観察するための実装。",
  },

  async solve(
    scenario: Scenario,
    options: SolverOptions,
    context: SolverContext,
  ): Promise<SolverResult> {
    const startedAt = context.now();

    const limits = checkLimits(scenario, options);
    if (!limits.ok) return limits.result!;

    const maxTime = defaultMaxTime(scenario);
    if (scenario.agents.length === 0) return emptyResult("no-solution", 0);

    const [first, ...rest] = scenario.agents;
    if (!first?.goal) {
      return emptyResult("error", context.now() - startedAt, {
        code: "invalid-scenario",
        message: "先頭エージェントに目標が設定されていません",
      });
    }

    const table = new SimpleReservationTable();
    const others: TimedPath[] = [];
    let expanded = 0;

    for (const agent of rest) {
      if (!agent.goal) continue;
      const out = spaceTimeAStar({
        map: scenario.map,
        start: agent.start,
        goal: agent.goal,
        agentId: agent.id,
        rules: scenario.rules,
        maxTime,
        maxExpansions: options.maxExpansions,
        heuristic: trueDistanceFrom(scenario.map, agent.goal),
      });
      expanded += out.expanded;
      if (out.path) {
        others.push(out.path);
        table.reservePath(out.path, maxTime);
      }
    }

    const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
    if (abort !== "ok") return emptyResult(abort, context.now() - startedAt);

    const out = spaceTimeAStar({
      map: scenario.map,
      start: first.start,
      goal: first.goal,
      agentId: first.id,
      rules: scenario.rules,
      reservations: table,
      reservationHorizon: maxTime,
      maxTime,
      maxExpansions: options.maxExpansions,
      heuristic: trueDistanceFrom(scenario.map, first.goal),
      onExpand: (cell, time) => {
        context.emit({ type: "expand-node", agentId: first.id, state: { cell, time } });
      },
    });
    expanded += out.expanded;

    if (!out.path) {
      return emptyResult(
        out.reason === "max-expansions" ? "node-limit" : "no-solution",
        context.now() - startedAt,
      );
    }

    const paths = [out.path, ...others];
    const result = buildResult(scenario, paths, context.now() - startedAt, expanded);
    context.emit({ type: "finish", result });
    return result;
  },
};
