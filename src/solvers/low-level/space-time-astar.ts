import type {
  AgentId,
  Cell,
  GridMap,
  ReservationTable,
  SimulationRules,
  Time,
  TimedPath,
  TimedPosition,
} from "@/lib/model/types.js";
import { cellEquals, lookupDistance, movesWithWait, trueDistanceFrom } from "@/lib/model/grid.js";

/**
 * 時空間 A*（低レベル探索）。
 *
 * 状態は (セル, 時刻)。1 ステップで隣接セルへ移動するか、その場で待つ。
 * 予約表が与えられていれば、他エージェントが占有する (セル, 時刻) と
 * 入れ替わり（edge swap）を避ける。
 *
 * ★ これは教材用の素朴な実装である。原論文の完全な再現ではない。
 *   - open list は配列 + 線形探索の優先度付きキュー（規模が小さいため）
 *   - ゴール到達後にそこへ留まれるかの検査は maxTime まで
 *   ここを差し替えたい場合は ALGORITHM_IMPLEMENTATION_GUIDE.md を参照。
 */

export interface SpaceTimeAStarInput {
  readonly map: GridMap;
  readonly start: Cell;
  readonly goal: Cell;
  readonly agentId: AgentId;
  readonly rules: SimulationRules;
  /** 他エージェントの占有。無ければ単一エージェント A* と同じ。 */
  readonly reservations?: ReservationTable;
  /** 予約表を見る上限時刻。これを超えたら他エージェントは居ないものとして扱う。 */
  readonly reservationHorizon?: Time;
  /** 探索する最大時刻。超えたら失敗。 */
  readonly maxTime: Time;
  /** 展開上限。超えたら失敗。 */
  readonly maxExpansions: number;
  /** ノード展開を通知する。可視化に使う。 */
  readonly onExpand?: (cell: Cell, time: Time, f: number) => void;
  /** 事前計算済みの真距離。無ければ内部で計算する。 */
  readonly heuristic?: Float64Array;
}

export interface SpaceTimeAStarOutput {
  readonly path: TimedPath | null;
  readonly expanded: number;
  readonly reason?: "no-path" | "max-time" | "max-expansions";
}

interface Node {
  readonly cell: Cell;
  readonly time: Time;
  readonly g: number;
  readonly f: number;
  readonly parent: Node | null;
}

function nodeKey(cell: Cell, time: Time): string {
  return `${cell.x},${cell.y}@${time}`;
}

export function spaceTimeAStar(input: SpaceTimeAStarInput): SpaceTimeAStarOutput {
  const { map, start, goal, agentId, rules, reservations, maxTime, maxExpansions, onExpand } =
    input;

  const horizon = input.reservationHorizon ?? maxTime;
  const h = input.heuristic ?? trueDistanceFrom(map, goal);
  const heuristicAt = (cell: Cell) => lookupDistance(map, h, cell);

  if (!Number.isFinite(heuristicAt(start))) {
    return { path: null, expanded: 0, reason: "no-path" };
  }

  const open: Node[] = [{ cell: start, time: 0, g: 0, f: heuristicAt(start), parent: null }];
  const best = new Map<string, number>([[nodeKey(start, 0), 0]]);
  let expanded = 0;

  while (open.length > 0) {
    // 最小 f を取り出す。同 f なら g が大きい方（ゴールに近い方）を優先。
    let bestIndex = 0;
    for (let i = 1; i < open.length; i += 1) {
      const a = open[i]!;
      const b = open[bestIndex]!;
      if (a.f < b.f || (a.f === b.f && a.g > b.g)) bestIndex = i;
    }
    const current = open.splice(bestIndex, 1)[0]!;

    expanded += 1;
    if (expanded > maxExpansions) {
      return { path: null, expanded, reason: "max-expansions" };
    }
    onExpand?.(current.cell, current.time, current.f);

    if (cellEquals(current.cell, goal)) {
      // ゴールに着いたあと、そこに留まり続けられるかを確認する。
      // 留まれない場合（他エージェントが後で通る）は解として採用しない。
      if (rules.goalBehavior === "disappear" || canStayForever(current.cell, current.time)) {
        return { path: reconstruct(agentId, current), expanded };
      }
    }

    if (current.time >= maxTime) continue;

    const nextTime = current.time + 1;
    for (const next of movesWithWait(map, current.cell, rules)) {
      if (isBlockedByReservation(current.cell, next, nextTime)) continue;

      const g = current.g + 1;
      const key = nodeKey(next, nextTime);
      const known = best.get(key);
      if (known !== undefined && known <= g) continue;

      const hv = heuristicAt(next);
      if (!Number.isFinite(hv)) continue;
      best.set(key, g);
      open.push({ cell: next, time: nextTime, g, f: g + hv, parent: current });
    }
  }

  return { path: null, expanded, reason: expanded > maxExpansions ? "max-expansions" : "no-path" };

  function isBlockedByReservation(from: Cell, to: Cell, time: Time): boolean {
    if (!reservations) return false;
    if (time > horizon) return false;
    if (reservations.isReserved(to, time, agentId)) return true;
    if (rules.forbidEdgeSwap && reservations.isEdgeReserved(from, to, time, agentId)) return true;
    return false;
  }

  function canStayForever(cell: Cell, from: Time): boolean {
    if (!reservations) return true;
    for (let t = from + 1; t <= horizon; t += 1) {
      if (reservations.isReserved(cell, t, agentId)) return false;
    }
    return true;
  }
}

function reconstruct(agentId: AgentId, goalNode: Node): TimedPath {
  const positions: TimedPosition[] = [];
  let node: Node | null = goalNode;
  while (node) {
    positions.push({ time: node.time, cell: node.cell });
    node = node.parent;
  }
  positions.reverse();
  return { agentId, positions };
}
