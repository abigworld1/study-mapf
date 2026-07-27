import type { Scenario, SolverMetrics, SolverResult, Time, TimedPath } from "@/lib/model/types.js";
import { detectConflicts, makespanOf, sumOfCosts } from "@/lib/model/conflicts.js";
import { manhattan } from "@/lib/model/grid.js";

/** 探索の打ち切り時刻。教材用に十分な範囲でありつつ、暴走を防ぐ。 */
export function defaultMaxTime(scenario: Scenario): Time {
  const { width, height } = scenario.map;
  const spread = scenario.agents.reduce(
    (max, a) => (a.goal ? Math.max(max, manhattan(a.start, a.goal)) : max),
    0,
  );
  return Math.max(width * height, spread * 4, 64) + scenario.agents.length * 2;
}

/**
 * 追加で計測できた統計。計測していない項目は渡さないこと。
 * ★ 0 を入れて埋めない。0 は「数えた結果 0 だった」を意味する。
 */
export interface ExtraMetrics {
  readonly generatedNodes?: number;
  readonly conflictsDetected?: number;
  readonly replans?: number;
  readonly lowerBound?: number;
  readonly suboptimalityBound?: number;
}

export function buildResult(
  scenario: Scenario,
  paths: readonly TimedPath[],
  runtimeMs: number,
  expandedNodes: number,
  outcome: SolverResult["outcome"] = "solved",
  extra?: ExtraMetrics,
): SolverResult {
  const conflicts = detectConflicts(paths, scenario.rules);
  const soc = sumOfCosts(paths);
  const metrics: SolverMetrics = {
    sumOfCosts: soc,
    makespan: makespanOf(paths),
    expandedNodes,
    runtimeMs,
    ...(extra ?? {}),
    // 下界が分かっていれば準最適性の上界も出せる。
    ...(extra?.lowerBound !== undefined &&
    extra.lowerBound > 0 &&
    extra.suboptimalityBound === undefined
      ? { suboptimalityBound: soc / extra.lowerBound }
      : {}),
  };
  return { outcome, paths, metrics, conflicts };
}

export function emptyResult(
  outcome: SolverResult["outcome"],
  runtimeMs: number,
  error?: SolverResult["error"],
): SolverResult {
  return {
    outcome,
    paths: [],
    metrics: { sumOfCosts: 0, makespan: 0, expandedNodes: 0, runtimeMs },
    conflicts: [],
    ...(error ? { error } : {}),
  };
}

/** 経路群から「時刻ごとの全エージェント位置」イベントを作る。アニメーションの素。 */
export function toMoveEvents(
  paths: readonly TimedPath[],
  rules: Scenario["rules"],
): { time: Time; positions: Record<string, { x: number; y: number }> }[] {
  const horizon = makespanOf(paths);
  const frames: { time: Time; positions: Record<string, { x: number; y: number }> }[] = [];
  for (let t = 0; t <= horizon; t += 1) {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const path of paths) {
      const list = path.positions;
      if (list.length === 0) continue;
      const last = list[list.length - 1]!;
      if (t > last.time) {
        if (rules.goalBehavior === "stay") positions[path.agentId] = last.cell;
        continue;
      }
      const found = list[t] && list[t]!.time === t ? list[t]! : list.find((p) => p.time === t);
      if (found) positions[path.agentId] = found.cell;
    }
    frames.push({ time: t, positions });
  }
  return frames;
}

/** タイムアウト・中断を一括で見る。 */
export function checkAbort(
  startedAt: number,
  now: () => number,
  timeoutMs: number,
  signal: AbortSignal,
): "ok" | "timeout" | "aborted" {
  if (signal.aborted) return "aborted";
  if (now() - startedAt > timeoutMs) return "timeout";
  return "ok";
}
