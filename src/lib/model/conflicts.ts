import type { AgentId, Cell, Conflict, SimulationRules, Time, TimedPath } from "./types.js";
import { cellEquals, cellKey } from "./grid.js";

/**
 * 経路上の時刻 t における位置。
 * 経路が尽きたあとは、ルールに応じて最終セルに留まる（stay）か、居なくなる（disappear）。
 */
export function positionAt(path: TimedPath, time: Time, rules: SimulationRules): Cell | null {
  const positions = path.positions;
  if (positions.length === 0) return null;
  const last = positions[positions.length - 1]!;
  if (time >= last.time) {
    return rules.goalBehavior === "disappear" && time > last.time ? null : last.cell;
  }
  // positions は time 昇順かつ連続している前提。
  const first = positions[0]!;
  if (time <= first.time) return first.cell;
  const found = positions[time - first.time];
  if (found && found.time === time) return found.cell;
  // 連続でない場合の保険。線形探索へ落とす。
  for (let i = positions.length - 1; i >= 0; i -= 1) {
    const p = positions[i]!;
    if (p.time <= time) return p.cell;
  }
  return first.cell;
}

export function pathEndTime(path: TimedPath): Time {
  const positions = path.positions;
  return positions.length === 0 ? 0 : positions[positions.length - 1]!.time;
}

export function makespanOf(paths: readonly TimedPath[]): Time {
  return paths.reduce((max, p) => Math.max(max, pathEndTime(p)), 0);
}

/**
 * sum of costs。
 * 各エージェントについて「最後にゴールへ到達した時刻」の総和。
 * ゴールに着いたあと待機し続ける分は数えない（mapf-benchmarks-2019 の定義に合わせる）。
 */
export function sumOfCosts(paths: readonly TimedPath[]): number {
  let total = 0;
  for (const path of paths) {
    const positions = path.positions;
    if (positions.length === 0) continue;
    const goal = positions[positions.length - 1]!.cell;
    let arrival = positions[positions.length - 1]!.time;
    for (let i = positions.length - 1; i >= 0; i -= 1) {
      const p = positions[i]!;
      if (cellEquals(p.cell, goal)) arrival = p.time;
      else break;
    }
    total += arrival;
  }
  return total;
}

/**
 * 全経路の衝突を検出する。
 * 計画結果の検証と、CBS 系の高レベルの両方から使う。
 */
export function detectConflicts(
  paths: readonly TimedPath[],
  rules: SimulationRules,
  limit = Number.POSITIVE_INFINITY,
): Conflict[] {
  const conflicts: Conflict[] = [];
  if (paths.length < 2) return conflicts;

  const horizon = makespanOf(paths);

  for (let t = 0; t <= horizon; t += 1) {
    // vertex conflict
    const occupied = new Map<string, AgentId>();
    for (const path of paths) {
      const cell = positionAt(path, t, rules);
      if (!cell) continue;
      const key = cellKey(cell);
      const other = occupied.get(key);
      if (other !== undefined) {
        conflicts.push({ kind: "vertex", agentA: other, agentB: path.agentId, cell, time: t });
        if (conflicts.length >= limit) return conflicts;
      } else {
        occupied.set(key, path.agentId);
      }
    }

    if (t === 0) continue;

    // edge-swap conflict
    if (rules.forbidEdgeSwap) {
      for (let i = 0; i < paths.length; i += 1) {
        for (let j = i + 1; j < paths.length; j += 1) {
          const a = paths[i]!;
          const b = paths[j]!;
          const aPrev = positionAt(a, t - 1, rules);
          const aNow = positionAt(a, t, rules);
          const bPrev = positionAt(b, t - 1, rules);
          const bNow = positionAt(b, t, rules);
          if (!aPrev || !aNow || !bPrev || !bNow) continue;
          if (cellEquals(aPrev, bNow) && cellEquals(aNow, bPrev) && !cellEquals(aPrev, aNow)) {
            conflicts.push({
              kind: "edge-swap",
              agentA: a.agentId,
              agentB: b.agentId,
              from: aPrev,
              to: aNow,
              time: t,
            });
            if (conflicts.length >= limit) return conflicts;
          }
        }
      }
    }

    // following conflict（既定では無効）
    if (rules.forbidFollowing) {
      for (let i = 0; i < paths.length; i += 1) {
        for (let j = 0; j < paths.length; j += 1) {
          if (i === j) continue;
          const a = paths[i]!;
          const b = paths[j]!;
          const aNow = positionAt(a, t, rules);
          const bPrev = positionAt(b, t - 1, rules);
          const bNow = positionAt(b, t, rules);
          if (!aNow || !bPrev || !bNow) continue;
          if (cellEquals(aNow, bPrev) && !cellEquals(bPrev, bNow)) {
            conflicts.push({
              kind: "following",
              agentA: a.agentId,
              agentB: b.agentId,
              cell: aNow,
              time: t,
            });
            if (conflicts.length >= limit) return conflicts;
          }
        }
      }
    }
  }
  return conflicts;
}

export function firstConflict(
  paths: readonly TimedPath[],
  rules: SimulationRules,
): Conflict | null {
  const found = detectConflicts(paths, rules, 1);
  return found[0] ?? null;
}
