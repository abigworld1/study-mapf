import type {
  AgentSpec,
  Cell,
  Conflict,
  GridMap,
  TaskSpec,
  TeamSpec,
  AssignmentSpec,
  Time,
  TimedPath,
} from "@/lib/model/types.js";
import { cellEquals } from "@/lib/model/grid.js";

/**
 * Canvas 2D レンダラ。
 *
 * ★ アルゴリズムのロジックからは完全に切り離す。
 *   この関数群は Solver の内部状態を知らない。渡された「今の見た目」だけを描く。
 *   アニメーションは SolverEvent か保存済みフレームから再生する。
 *
 * ★ 色だけでエージェントを識別させない。
 *   番号ラベルと形（円 / 角丸四角 / ひし形 / 三角）を併用する。
 */

export type LayerName =
  | "grid"
  | "obstacles"
  | "tasks"
  | "planned-paths"
  | "reservations"
  | "constraints"
  | "conflicts"
  | "agents"
  | "labels"
  | "selection";

export interface RenderTheme {
  bg: string;
  gridLine: string;
  obstacle: string;
  goalRing: string;
  path: string;
  reservation: string;
  conflict: string;
  label: string;
  agents: string[];
}

export function readTheme(root: HTMLElement = document.documentElement): RenderTheme {
  const css = getComputedStyle(root);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--canvas-bg", "#ffffff"),
    gridLine: v("--canvas-grid-line", "#dddddd"),
    obstacle: v("--canvas-obstacle", "#444444"),
    goalRing: v("--canvas-goal-ring", "#777777"),
    path: v("--canvas-path", "#888888"),
    reservation: v("--canvas-reservation", "rgba(0,0,255,0.15)"),
    conflict: v("--canvas-conflict", "#cc0000"),
    label: v("--canvas-label", "#111111"),
    agents: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--agent-${i}`, "#0f5c8c")),
  };
}

export interface Viewport {
  readonly cellSize: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export function computeViewport(canvas: HTMLCanvasElement, map: GridMap): Viewport {
  const rect = canvas.getBoundingClientRect();
  const cellSize = Math.max(
    4,
    Math.floor(Math.min(rect.width / map.width, rect.height / map.height)),
  );
  return {
    cellSize,
    offsetX: Math.floor((rect.width - cellSize * map.width) / 2),
    offsetY: Math.floor((rect.height - cellSize * map.height) / 2),
  };
}

export function cellFromPoint(
  viewport: Viewport,
  map: GridMap,
  px: number,
  py: number,
): Cell | null {
  const x = Math.floor((px - viewport.offsetX) / viewport.cellSize);
  const y = Math.floor((py - viewport.offsetY) / viewport.cellSize);
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
  return { x, y };
}

export interface RenderState {
  readonly map: GridMap;
  readonly agents: readonly AgentSpec[];
  readonly tasks?: readonly TaskSpec[];
  /** MAPD の non-task endpoint（退避してよい場所）。作業地点とは描き分ける。 */
  readonly nonTaskEndpoints?: readonly Cell[];
  /** TAPF のチーム。target は割当前なのでエージェントの goal とは別に描く。 */
  readonly teams?: readonly TeamSpec[];
  readonly assignment?: AssignmentSpec;
  /** 解けたあとの目標割当。描画では target にエージェント名を添えるのに使う。 */
  readonly targetAssignments?: readonly {
    readonly agentId: string;
    readonly teamId?: string;
    readonly targetId?: string;
    readonly goal: Cell;
  }[];
  /** 現在時刻におけるエージェント位置。 */
  readonly positions: Readonly<Record<string, Cell>>;
  readonly paths?: readonly TimedPath[];
  readonly reservations?: readonly { cell: Cell; agentId: string }[];
  readonly conflicts?: readonly Conflict[];
  readonly time: Time;
  readonly selected?: Cell | null;
  readonly layers: Readonly<Record<LayerName, boolean>>;
}

const AGENT_SHAPES = ["circle", "square", "diamond", "triangle"] as const;

export function render(canvas: HTMLCanvasElement, state: RenderState, theme: RenderTheme): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const vp = computeViewport(canvas, state.map);
  const { cellSize: s, offsetX: ox, offsetY: oy } = vp;
  const px = (c: number) => ox + c * s;
  const py = (r: number) => oy + r * s;

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, rect.width, rect.height);

  // --- grid
  if (state.layers.grid) {
    ctx.strokeStyle = theme.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= state.map.width; x += 1) {
      ctx.moveTo(px(x) + 0.5, py(0));
      ctx.lineTo(px(x) + 0.5, py(state.map.height));
    }
    for (let y = 0; y <= state.map.height; y += 1) {
      ctx.moveTo(px(0), py(y) + 0.5);
      ctx.lineTo(px(state.map.width), py(y) + 0.5);
    }
    ctx.stroke();
  }

  // --- obstacles
  if (state.layers.obstacles) {
    ctx.fillStyle = theme.obstacle;
    for (let y = 0; y < state.map.height; y += 1) {
      for (let x = 0; x < state.map.width; x += 1) {
        if (state.map.blocked[y * state.map.width + x]) {
          ctx.fillRect(px(x) + 1, py(y) + 1, s - 2, s - 2);
        }
      }
    }
  }

  /*
    --- MAPD の non-task endpoint（退避地点）
    ★ 作業地点（pickup / delivery）とは別物なので描き分ける。
      mapd-tp-tpts-central-2017 p.2 §3.2 では、エージェントが永久に留まって
      よいのは endpoint だけで、そのうち作業地点でないものが退避先になる。
      TP の Path2 が使うのはこちらなので、どこが退避できる場所なのかが
      見えないと手法の説明が読めない。
  */
  if (state.layers.tasks && state.nonTaskEndpoints) {
    ctx.save();
    ctx.strokeStyle = theme.goalRing;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 2]);
    for (const cell of state.nonTaskEndpoints) {
      ctx.beginPath();
      ctx.arc(px(cell.x) + s / 2, py(cell.y) + s / 2, s * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- tasks（MAPD の pickup / delivery）
  if (state.layers.tasks && state.tasks) {
    ctx.lineWidth = 2;
    for (const task of state.tasks) {
      ctx.strokeStyle = theme.goalRing;
      ctx.strokeRect(px(task.pickup.x) + 3, py(task.pickup.y) + 3, s - 6, s - 6);
      ctx.beginPath();
      ctx.moveTo(px(task.delivery.x) + s / 2, py(task.delivery.y) + 4);
      ctx.lineTo(px(task.delivery.x) + s - 4, py(task.delivery.y) + s - 4);
      ctx.lineTo(px(task.delivery.x) + 4, py(task.delivery.y) + s - 4);
      ctx.closePath();
      ctx.stroke();
    }
  }

  // --- reservations
  if (state.layers.reservations && state.reservations) {
    ctx.fillStyle = theme.reservation;
    for (const r of state.reservations) {
      ctx.fillRect(px(r.cell.x) + 2, py(r.cell.y) + 2, s - 4, s - 4);
    }
  }

  // --- planned paths
  if (state.layers["planned-paths"] && state.paths) {
    ctx.lineWidth = Math.max(1.5, s * 0.1);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    state.paths.forEach((path, i) => {
      const agent = state.agents.find((a) => a.id === path.agentId);
      const color = theme.agents[(agent?.colorIndex ?? i) % theme.agents.length] ?? theme.path;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      path.positions.forEach((p, idx) => {
        const cx = px(p.cell.x) + s / 2;
        const cy = py(p.cell.y) + s / 2;
        if (idx === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }

  /*
    --- TAPF のチーム target
    ★ エージェントの goal（実線のリング）とは別物なので、描き分ける。
      TAPF では割当が解の一部で、実行前はどの target を誰が取るか決まっていない。
      同じ見た目にすると「もう割り当て済み」に見えてしまうため、
      未割当は破線の四角、割当済みはそこへ実線を重ねる。
      色だけに頼らないよう、割当済みにはエージェント番号も添える。
  */
  if ((state.teams && state.teams.length > 0) || state.assignment) {
    ctx.lineWidth = 2;
    (state.teams ?? []).forEach((team, teamIndex) => {
      const color =
        theme.agents[(team.colorIndex ?? teamIndex) % theme.agents.length] ?? theme.goalRing;
      for (const goal of team.goals) {
        ctx.strokeStyle = color;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(px(goal.x) + 5, py(goal.y) + 5, s - 10, s - 10);
        ctx.setLineDash([]);
      }
    });
    const genericTargets = state.assignment?.targets ?? [];
    for (const target of genericTargets) {
      ctx.strokeStyle = theme.goalRing;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(px(target.cell.x) + 5, py(target.cell.y) + 5, s - 10, s - 10);
      ctx.setLineDash([]);
    }
    for (const assignment of state.targetAssignments ?? []) {
      const teamIndex = assignment.teamId
        ? (state.teams ?? []).findIndex((t) => t.id === assignment.teamId)
        : -1;
      const team = teamIndex >= 0 ? state.teams?.[teamIndex] : undefined;
      const color =
        theme.agents[
          (team?.colorIndex ??
            Math.max(
              0,
              state.agents.findIndex((a) => a.id === assignment.agentId),
            )) % theme.agents.length
        ] ?? theme.goalRing;
      ctx.strokeStyle = color;
      ctx.strokeRect(px(assignment.goal.x) + 5, py(assignment.goal.y) + 5, s - 10, s - 10);
      if (state.layers.labels) {
        ctx.fillStyle = color;
        ctx.font = `${Math.max(9, Math.floor(s * 0.28))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          assignment.agentId,
          px(assignment.goal.x) + s / 2,
          py(assignment.goal.y) + s / 2,
        );
      }
    }
  }

  // --- goals（エージェントの目標。リングで示す）
  ctx.lineWidth = 2;
  state.agents.forEach((agent, i) => {
    if (!agent.goal) return;
    const color = theme.agents[(agent.colorIndex ?? i) % theme.agents.length] ?? theme.goalRing;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(px(agent.goal.x) + s / 2, py(agent.goal.y) + s / 2, s * 0.33, 0, Math.PI * 2);
    ctx.stroke();
  });

  // --- conflicts
  if (state.layers.conflicts && state.conflicts) {
    ctx.strokeStyle = theme.conflict;
    ctx.lineWidth = 3;
    for (const c of state.conflicts) {
      const cell = c.kind === "edge-swap" ? c.to : c.cell;
      ctx.strokeRect(px(cell.x) + 2, py(cell.y) + 2, s - 4, s - 4);
      ctx.beginPath();
      ctx.moveTo(px(cell.x) + 5, py(cell.y) + 5);
      ctx.lineTo(px(cell.x) + s - 5, py(cell.y) + s - 5);
      ctx.moveTo(px(cell.x) + s - 5, py(cell.y) + 5);
      ctx.lineTo(px(cell.x) + 5, py(cell.y) + s - 5);
      ctx.stroke();
    }
  }

  // --- agents
  if (state.layers.agents) {
    state.agents.forEach((agent, i) => {
      const pos = state.positions[agent.id];
      if (!pos) return;
      const colorIndex = (agent.colorIndex ?? i) % theme.agents.length;
      const color = theme.agents[colorIndex] ?? "#0f5c8c";
      const cx = px(pos.x) + s / 2;
      const cy = py(pos.y) + s / 2;
      const r = s * 0.34;

      ctx.fillStyle = color;
      // 形も変える。色覚特性や白黒印刷でも区別できるようにする。
      const shape = AGENT_SHAPES[colorIndex % AGENT_SHAPES.length];
      ctx.beginPath();
      if (shape === "circle") {
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      } else if (shape === "square") {
        ctx.rect(cx - r, cy - r, r * 2, r * 2);
      } else if (shape === "diamond") {
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r, cy);
        ctx.closePath();
      } else {
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy + r);
        ctx.lineTo(cx - r, cy + r);
        ctx.closePath();
      }
      ctx.fill();

      // --- labels（番号。色以外の識別手段）
      if (state.layers.labels && s >= 16) {
        ctx.fillStyle = theme.bg;
        ctx.font = `bold ${Math.floor(s * 0.42)}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), cx, cy + 0.5);
      }
    });
  }

  // --- selection
  if (state.layers.selection && state.selected) {
    ctx.strokeStyle = theme.label;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(px(state.selected.x) + 1, py(state.selected.y) + 1, s - 2, s - 2);
    ctx.setLineDash([]);
  }
}

/**
 * Canvas の内容を文章で説明する。
 * スクリーンリーダー向けと、Canvas が読めない環境向けの補足。
 */
export function describeState(state: RenderState): string {
  const parts: string[] = [];
  parts.push(`${state.map.width}×${state.map.height} のグリッド。時刻 ${state.time}。`);
  const walls = state.map.blocked.filter(Boolean).length;
  parts.push(`壁 ${walls} マス。`);
  parts.push(`エージェント ${state.agents.length} 体。`);
  for (const [i, agent] of state.agents.entries()) {
    const pos = state.positions[agent.id];
    if (!pos) continue;
    const atGoal = agent.goal && cellEquals(pos, agent.goal);
    parts.push(
      `エージェント${i + 1}（${agent.id}）は (${pos.x}, ${pos.y})` +
        (agent.goal
          ? `、目標 (${agent.goal.x}, ${agent.goal.y})${atGoal ? "、到達済み" : ""}`
          : "") +
        "。",
    );
  }
  if (state.conflicts && state.conflicts.length > 0) {
    parts.push(`衝突 ${state.conflicts.length} 件を検出しています。`);
  }
  return parts.join(" ");
}
