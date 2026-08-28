import type { Cell, Scenario } from "@/lib/model/types.js";
import { cellEquals, isWalkable } from "@/lib/model/grid.js";

/**
 * シミュレータのドラッグ操作。
 *
 * ★ React から切り離した純関数として置く。
 *   「どこを掴めるか」「どこへ置けるか」は盤面の意味に関わる判断なので、
 *   コンポーネントの中に埋めるとテストできない。
 *
 * ★ 掴めるのは「利用者が直接決めた位置」だけ。
 *   MAPD の non-task endpoint のように他の情報から導出しているものは
 *   掴ませない（mapd-tp-tpts-central-2017 p.2 §3.2 の V_ep は
 *   エージェント初期位置とタスク地点から決まるので、単独では動かせない）。
 */
export type DragTarget =
  | { readonly kind: "agent-start"; readonly agentId: string }
  | { readonly kind: "agent-goal"; readonly agentId: string }
  | { readonly kind: "task-pickup"; readonly taskId: string }
  | { readonly kind: "task-delivery"; readonly taskId: string }
  | { readonly kind: "team-target"; readonly teamId: string; readonly index: number };

/**
 * そのセルで掴めるものを返す。
 *
 * ★ 優先順位は「重なったときに動かしたいであろう順」。
 *   エージェント本体が一番手前で、次にその目標、最後にタスク地点。
 *   同じセルに複数あるとき、奥のものを掴みたければ手前のものを先にどければよい。
 */
export function findDragTarget(scenario: Scenario, cell: Cell): DragTarget | null {
  for (const agent of scenario.agents) {
    if (cellEquals(agent.start, cell)) return { kind: "agent-start", agentId: agent.id };
  }
  for (const agent of scenario.agents) {
    if (agent.goal && cellEquals(agent.goal, cell)) {
      return { kind: "agent-goal", agentId: agent.id };
    }
  }
  for (const task of scenario.tasks ?? []) {
    if (cellEquals(task.pickup, cell)) return { kind: "task-pickup", taskId: task.id };
  }
  for (const task of scenario.tasks ?? []) {
    if (cellEquals(task.delivery, cell)) return { kind: "task-delivery", taskId: task.id };
  }
  for (const team of scenario.teams ?? []) {
    const index = team.goals.findIndex((goal) => cellEquals(goal, cell));
    if (index >= 0) return { kind: "team-target", teamId: team.id, index };
  }
  return null;
}

/** 掴んでいるものが、いまどのセルに居るか。 */
export function dragTargetCell(scenario: Scenario, target: DragTarget): Cell | null {
  switch (target.kind) {
    case "agent-start":
      return scenario.agents.find((a) => a.id === target.agentId)?.start ?? null;
    case "agent-goal":
      return scenario.agents.find((a) => a.id === target.agentId)?.goal ?? null;
    case "task-pickup":
      return (scenario.tasks ?? []).find((t) => t.id === target.taskId)?.pickup ?? null;
    case "task-delivery":
      return (scenario.tasks ?? []).find((t) => t.id === target.taskId)?.delivery ?? null;
    case "team-target":
      return (
        (scenario.teams ?? []).find((t) => t.id === target.teamId)?.goals[target.index] ?? null
      );
  }
}

/**
 * 掴んでいるものを cell へ動かした Scenario を返す。置けないなら null。
 *
 * ★ 置けない理由はモデル側の制約から来る。ここで勝手に緩めないこと。
 *   - 壁の上には何も置けない
 *   - エージェントの開始位置は重ねられない（同時刻に同じセルは vertex conflict）
 *   - TAPF の target は重複できない（cbm-tapf-aamas-2016 p.2 が unique targets と定義。
 *     validateScenario も同じ条件を検査している）
 *
 * ★ タスクの pickup / delivery は重なってよい。論文側に禁止は無く、
 *   実際 mapd-parking プリセットは 2 つのタスクの delivery が同じセルにある。
 */
export function moveDragTarget(
  scenario: Scenario,
  target: DragTarget,
  cell: Cell,
): Scenario | null {
  if (!isWalkable(scenario.map, cell)) return null;
  const from = dragTargetCell(scenario, target);
  if (from && cellEquals(from, cell)) return scenario;

  switch (target.kind) {
    case "agent-start": {
      const taken = scenario.agents.some(
        (agent) => agent.id !== target.agentId && cellEquals(agent.start, cell),
      );
      if (taken) return null;
      return {
        ...scenario,
        agents: scenario.agents.map((agent) =>
          agent.id === target.agentId ? { ...agent, start: { ...cell } } : agent,
        ),
      };
    }
    case "agent-goal": {
      return {
        ...scenario,
        agents: scenario.agents.map((agent) =>
          agent.id === target.agentId ? { ...agent, goal: { ...cell } } : agent,
        ),
      };
    }
    case "task-pickup":
    case "task-delivery": {
      const key = target.kind === "task-pickup" ? "pickup" : "delivery";
      return {
        ...scenario,
        tasks: (scenario.tasks ?? []).map((task) =>
          task.id === target.taskId ? { ...task, [key]: { ...cell } } : task,
        ),
      };
    }
    case "team-target": {
      const duplicated = (scenario.teams ?? []).some((team) =>
        team.goals.some(
          (goal, index) =>
            cellEquals(goal, cell) && !(team.id === target.teamId && index === target.index),
        ),
      );
      if (duplicated) return null;
      return {
        ...scenario,
        teams: (scenario.teams ?? []).map((team) =>
          team.id === target.teamId
            ? {
                ...team,
                goals: team.goals.map((goal, index) =>
                  index === target.index ? { ...cell } : goal,
                ),
              }
            : team,
        ),
      };
    }
  }
}

/** 掴んでいるものの説明。支援技術向けの読み上げと、掴んだ旨の表示に使う。 */
export function describeDragTarget(target: DragTarget): string {
  switch (target.kind) {
    case "agent-start":
      return `${target.agentId} の開始位置`;
    case "agent-goal":
      return `${target.agentId} の目標`;
    case "task-pickup":
      return `${target.taskId} の pickup`;
    case "task-delivery":
      return `${target.taskId} の delivery`;
    case "team-target":
      return `${target.teamId} の target`;
  }
}

/**
 * 壁を塗るときの対象セルか。
 *
 * ★ 何かが乗っているセルは塗らない。乗っているものを壁で潰すと、
 *   壁の下に開始位置や目標が隠れた不正な盤面になる。
 */
export function canPaintWall(scenario: Scenario, cell: Cell): boolean {
  return findDragTarget(scenario, cell) === null;
}
