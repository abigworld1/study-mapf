import type { AgentId, Cell, ReservationTable, Time, TimedPath } from "./types.js";
import { cellEquals } from "./grid.js";
import { positionAt } from "./conflicts.js";
import type { SimulationRules } from "./types.js";

interface Entry {
  readonly agentId: AgentId;
  readonly cell: Cell;
}

/**
 * 予約表の素朴な実装。
 * cooperative-pathfinding-2005 の reservation table に相当する。
 *
 * Map<time, Map<cellKey, Entry>> で持つ。
 * 教材用途の規模（〜数千セル × 〜数百ステップ）では十分速い。
 * 大規模化するなら SIPPwRT のような区間表現へ置き換えること。
 */
export class SimpleReservationTable implements ReservationTable {
  private readonly byTime = new Map<Time, Map<string, Entry>>();
  /** 辺の予約。key = "x1,y1>x2,y2@t"。edge swap 判定に使う。 */
  private readonly edges = new Map<string, AgentId>();

  private static key(cell: Cell): string {
    return `${cell.x},${cell.y}`;
  }

  private static edgeKey(from: Cell, to: Cell, time: Time): string {
    return `${from.x},${from.y}>${to.x},${to.y}@${time}`;
  }

  isReserved(cell: Cell, time: Time, exceptAgent?: AgentId): boolean {
    const slot = this.byTime.get(time);
    if (!slot) return false;
    const entry = slot.get(SimpleReservationTable.key(cell));
    if (!entry) return false;
    return exceptAgent === undefined ? true : entry.agentId !== exceptAgent;
  }

  /** from→to の逆向き（to→from）が同時刻に予約されていれば edge swap になる。 */
  isEdgeReserved(from: Cell, to: Cell, time: Time, exceptAgent?: AgentId): boolean {
    if (cellEquals(from, to)) return false;
    const owner = this.edges.get(SimpleReservationTable.edgeKey(to, from, time));
    if (owner === undefined) return false;
    return exceptAgent === undefined ? true : owner !== exceptAgent;
  }

  reserve(agentId: AgentId, cell: Cell, time: Time): void {
    let slot = this.byTime.get(time);
    if (!slot) {
      slot = new Map<string, Entry>();
      this.byTime.set(time, slot);
    }
    slot.set(SimpleReservationTable.key(cell), { agentId, cell });
  }

  reserveEdge(agentId: AgentId, from: Cell, to: Cell, time: Time): void {
    if (cellEquals(from, to)) return;
    this.edges.set(SimpleReservationTable.edgeKey(from, to, time), agentId);
  }

  /**
   * 経路全体を予約する。
   * horizon まで最終セルを押さえ続けるのは、ゴール到達後 stay の既定ルールに合わせるため。
   */
  reservePath(path: TimedPath, horizon: Time): void {
    const positions = path.positions;
    if (positions.length === 0) return;
    for (let i = 0; i < positions.length; i += 1) {
      const p = positions[i]!;
      this.reserve(path.agentId, p.cell, p.time);
      if (i > 0) {
        const prev = positions[i - 1]!;
        this.reserveEdge(path.agentId, prev.cell, p.cell, p.time);
      }
    }
    const last = positions[positions.length - 1]!;
    for (let t = last.time + 1; t <= horizon; t += 1) {
      this.reserve(path.agentId, last.cell, t);
    }
  }

  clearAgent(agentId: AgentId): void {
    for (const slot of this.byTime.values()) {
      for (const [key, entry] of slot) {
        if (entry.agentId === agentId) slot.delete(key);
      }
    }
    for (const [key, owner] of this.edges) {
      if (owner === agentId) this.edges.delete(key);
    }
  }

  reservedAt(time: Time): readonly { cell: Cell; agentId: AgentId }[] {
    const slot = this.byTime.get(time);
    if (!slot) return [];
    return [...slot.values()].map((e) => ({ cell: e.cell, agentId: e.agentId }));
  }

  /** 可視化用。予約されている最大時刻。 */
  get maxTime(): Time {
    let max = 0;
    for (const t of this.byTime.keys()) max = Math.max(max, t);
    return max;
  }
}

/** 既存の経路群から予約表を作る。優先順位付き計画で使う。 */
export function buildReservationTable(
  paths: readonly TimedPath[],
  horizon: Time,
  _rules: SimulationRules,
): SimpleReservationTable {
  const table = new SimpleReservationTable();
  for (const path of paths) table.reservePath(path, horizon);
  return table;
}

/** デバッグ用。時刻 t にどのエージェントがどこを押さえているか。 */
export function describeReservations(table: ReservationTable, time: Time): string {
  return table
    .reservedAt(time)
    .map((r) => `${r.agentId}@(${r.cell.x},${r.cell.y})`)
    .join(" ");
}

export { positionAt };
