import type {
  AgentId,
  Cell,
  MapfSolver,
  Scenario,
  SolverResult,
  TaskId,
  TimedPath,
} from "@/lib/model/types.js";
import { lookupDistance, trueDistanceFrom } from "@/lib/model/grid.js";
import { SimpleReservationTable } from "@/lib/model/reservation.js";
import { spaceTimeAStar } from "../low-level/space-time-astar.js";
import { runMapdLoop, type MapdStepInput, type MapdStepOutput, type MapdStrategy } from "./loop.js";

/**
 * MAPD の素朴なベースライン。
 *
 * ★ これは Token Passing ではない。論文の手法でもない。
 *   MAPD の実行ループが動くことを確かめ、Batch 8（TP / TPTS / CENTRAL）の
 *   対照として置くためのもので、`algorithms.yaml` には登録しない。
 *
 * ★ TP との決定的な違いは endpoint 規律が無いこと。
 *   mapd-tp-tpts-central-2017 p.2 §3.2 は「エージェントが永久に留まって
 *   よいのは endpoint だけ」と定め、p.3-4 の Path2 / Property 2 が
 *   「手が空いたエージェントを、他を塞がない non-task endpoint へ退かせる」
 *   ことでデッドロックを防いでいる。この実装はそれをやらず、手が空いた
 *   エージェントはその場に居座る。作業地点や通路の上で止まると後続を
 *   塞ぐので、詰まる様子そのものが Property 2 の存在理由の説明になる。
 *
 * ★ もう 1 つの簡略化として、pickup → delivery を 1 本の探索で解かず、
 *   start → pickup と pickup → delivery の 2 回に分けている。
 *   途中で必ず経由する地点を 1 本の探索で扱うのが MLA*（Batch 8）で、
 *   分けると経由地点の待ち時間を最適化できない。
 */
export const mapdGreedySolver: MapfSolver = {
  metadata: {
    id: "mapd-greedy",
    displayName: "貪欲割当（MAPD ベースライン）",
    originalName: "Greedy MAPD baseline",
    category: "mapd",
    supports: ["mapd"],
    status: "runnable",
    fidelity: "educational",
    unsupportedRules: ["allowDiagonal", "forbidFollowing"],
    basedOnPaperIds: ["mapd-tp-tpts-central-2017"],
    implementationNote:
      "論文手法ではないサイト独自のベースライン。手の空いたエージェントに最も近い未割当タスクを渡し、予約表を見ながら時空間 A* で pickup → delivery を計画する。TP の endpoint 規律（同 p.3-4 の Path2 / Property 2）が無いため、手が空いたエージェントがその場に居座って後続を塞ぐことがある。pickup 経由も 2 回の探索に分けており、MLA* のように 1 本では解かない。理論保証は無い。",
  },
  canSolve: (scenario) => scenario.kind === "mapd" && (scenario.tasks?.length ?? 0) > 0,
  async solve(scenario, options, context): Promise<SolverResult> {
    return runMapdLoop(scenario, options, context, new GreedyStrategy());
  },
};

class GreedyStrategy implements MapdStrategy {
  readonly name = "greedy";
  /** agentId -> 絶対時刻つきの残り経路。先頭が「次に居るべき位置」。 */
  private plans = new Map<AgentId, { time: number; cell: Cell }[]>();
  private reservations = new SimpleReservationTable();
  private distanceCache = new Map<string, Float64Array>();
  private horizon = 0;

  init(scenario: Scenario): string | null {
    this.plans.clear();
    this.reservations = new SimpleReservationTable();
    this.distanceCache.clear();
    this.horizon = scenario.map.width * scenario.map.height * 2;
    /*
      ★ 手が空いているエージェントは、その場を占め続ける。
        TP なら non-task endpoint へ退くところ。この居座りが後続を塞ぐ。
    */
    for (const agent of scenario.agents) {
      this.reservations.reservePath(
        { agentId: agent.id, positions: [{ time: 0, cell: agent.start }] },
        this.horizon,
      );
    }
    return null;
  }

  step(input: MapdStepInput): MapdStepOutput {
    const assign = new Map<AgentId, TaskId>();
    const moves = new Map<AgentId, Cell>();
    const now = input.time;

    /*
      ★ 割当は「手が空いていて、かつ計画も持たないエージェント」だけを対象に、
        pickup までの真距離が最小の組を貪欲に選ぶ。
        論文の TP は token を 1 体ずつ回して各自が選ぶが、ここは中央で決める。
        素朴さを見せるのが目的なので最適化していない。
    */
    const free = input.scenario.agents
      .map((agent) => agent.id)
      .filter((id) => !input.carrying.has(id) && !this.hasPlan(id));
    const open = [...input.openTasks].sort(
      (a, b) => a.releaseTime - b.releaseTime || (a.id < b.id ? -1 : 1),
    );

    for (const agentId of free) {
      let best: { index: number; distance: number } | undefined;
      const from = input.positions.get(agentId)!;
      for (const [index, task] of open.entries()) {
        const distance = this.distanceTo(input.scenario, task.pickup, from);
        if (!Number.isFinite(distance)) continue;
        if (!best || distance < best.distance) best = { index, distance };
      }
      if (!best) continue;
      const task = open[best.index]!;
      const planned = this.planTask(input, agentId, from, now, task.pickup, task.delivery);
      if (!planned) continue;
      assign.set(agentId, task.id);
      open.splice(best.index, 1);
    }

    // 計画を 1 歩ぶん消化する。計画が無ければその場。
    for (const agent of input.scenario.agents) {
      const at = input.positions.get(agent.id)!;
      const plan = this.plans.get(agent.id);
      const next = plan?.find((p) => p.time === now + 1);
      moves.set(agent.id, next ? next.cell : at);
      if (plan && next && next.time >= plan[plan.length - 1]!.time) {
        this.finishPlan(agent.id, next.cell, next.time);
      }
    }
    return { assign, moves };
  }

  private hasPlan(agentId: AgentId): boolean {
    return (this.plans.get(agentId)?.length ?? 0) > 0;
  }

  /**
   * start → pickup → delivery を計画し、予約表へ入れる。
   *
   * ★ 2 回に分けて探索する。1 本で扱うのが MLA*（Batch 8）。
   *   分けたぶん、pickup での待ち時間を最適化できない。
   */
  private planTask(
    input: MapdStepInput,
    agentId: AgentId,
    from: Cell,
    now: number,
    pickup: Cell,
    delivery: Cell,
  ): boolean {
    // 居座りの予約を外してから引き直す。外さないと自分自身に阻まれる。
    this.reservations.clearAgent(agentId);

    const first = this.search(input.scenario, agentId, from, pickup, now);
    if (!first) return this.restIdle(agentId, from, now);
    const pickupTime = first[first.length - 1]!.time;
    const second = this.search(input.scenario, agentId, pickup, delivery, pickupTime);
    if (!second) return this.restIdle(agentId, from, now);

    const positions = [...first, ...second.slice(1)];
    const path: TimedPath = { agentId, positions };
    this.reservations.reservePath(path, this.horizon);
    this.plans.set(
      agentId,
      positions.map((p) => ({ time: p.time, cell: p.cell })),
    );
    return true;
  }

  /** 計画を作れなかったので、その場に居座る予約へ戻す。 */
  private restIdle(agentId: AgentId, at: Cell, now: number): boolean {
    this.reservations.reservePath({ agentId, positions: [{ time: now, cell: at }] }, this.horizon);
    this.plans.delete(agentId);
    return false;
  }

  /** 計画を使い切った。到達地点に居座る予約へ切り替える。 */
  private finishPlan(agentId: AgentId, at: Cell, time: number): void {
    this.plans.delete(agentId);
    this.reservations.clearAgent(agentId);
    this.reservations.reservePath({ agentId, positions: [{ time, cell: at }] }, this.horizon);
  }

  private search(
    scenario: Scenario,
    agentId: AgentId,
    from: Cell,
    to: Cell,
    startTime: number,
  ): { time: number; cell: Cell }[] | null {
    const output = spaceTimeAStar({
      map: scenario.map,
      start: from,
      goal: to,
      agentId,
      rules: scenario.rules,
      reservations: this.reservations,
      reservationHorizon: this.horizon,
      startTime,
      maxTime: startTime + scenario.map.width * scenario.map.height,
      maxExpansions: 50_000,
      heuristic: this.distanceField(scenario, to),
    });
    if (!output.path) return null;
    return output.path.positions.map((p) => ({ time: p.time, cell: p.cell }));
  }

  private distanceField(scenario: Scenario, goal: Cell): Float64Array {
    const key = `${goal.x},${goal.y}`;
    let field = this.distanceCache.get(key);
    if (!field) {
      field = trueDistanceFrom(scenario.map, goal);
      this.distanceCache.set(key, field);
    }
    return field;
  }

  private distanceTo(scenario: Scenario, goal: Cell, from: Cell): number {
    return lookupDistance(scenario.map, this.distanceField(scenario, goal), from);
  }
}
