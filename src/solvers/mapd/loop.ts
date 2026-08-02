import type {
  AgentId,
  Cell,
  Scenario,
  SolverContext,
  SolverEvent,
  SolverOptions,
  SolverResult,
  SolverWarning,
  TaskId,
  TaskSpec,
  TimedPath,
} from "@/lib/model/types.js";
import { cellEquals, neighbors } from "@/lib/model/grid.js";
import { detectConflicts, makespanOf, sumOfCosts } from "@/lib/model/conflicts.js";
import { checkWellFormed, endpointsOf, type MapdEndpoints } from "@/lib/model/mapd.js";
import { checkLimits } from "../limits.js";
import { createTraceRecorder } from "../context.js";
import { checkAbort } from "../shared.js";

/**
 * MAPD の実行ループ。
 *
 * ★ ここは「時間を進める係」だけを担当し、割当も経路計画も一切決めない。
 *   決めるのは MapdStrategy 側。Batch 8 の TP / TPTS / CENTRAL は
 *   戦略だけを書けば済むようにしてある。
 *
 * ★ 1 ステップの順序は次で固定する。この順序を変えると service time が
 *   1 ずれるので、手法を差し替えても比較できるようにここで決め切る。
 *
 *     1. 時刻 t に releaseTime <= t のタスクを task set へ入れる（release-task）
 *     2. 戦略に「いま何をするか」を尋ねる（割当と経路の更新）
 *     3. 全エージェントを 1 歩進める（move）
 *     4. pickup / delivery を判定して計上する（pickup / delivery）
 *
 *   pickup と delivery を移動の後に見るのは、時刻 t の位置が確定してから
 *   でないと「その地点に居る」を判定できないため。
 *
 * ★ service time は mapd-tp-tpts-central-2017 p.2 §3.1 の定義で測る。
 *   「the average number of timesteps, called service time, needed to
 *     finish executing each task after it was added to the task set」
 *   起点は releaseTime。割当時刻でも pickup 時刻でもない。
 */

/** 実行ループが戦略へ渡す、その時刻のスナップショット。 */
export interface MapdStepInput {
  readonly scenario: Scenario;
  readonly time: number;
  /** いま各エージェントが居るセル。 */
  readonly positions: ReadonlyMap<AgentId, Cell>;
  /** release 済みで、まだどのエージェントにも割り当てられていないタスク。 */
  readonly openTasks: readonly TaskSpec[];
  /** 実行中のタスク。agentId -> タスクと、pickup を終えたかどうか。 */
  readonly carrying: ReadonlyMap<AgentId, { readonly task: TaskSpec; readonly pickedUp: boolean }>;
  /** 論文 §3.2 の endpoint 集合。TP の Path2 が non-task endpoint を要る。 */
  readonly endpoints: MapdEndpoints;
  readonly emit: (event: SolverEvent) => void;
}

/** 戦略がその時刻に決めたこと。 */
export interface MapdStepOutput {
  /** 新しく割り当てたタスク。agentId -> taskId。 */
  readonly assign?: ReadonlyMap<AgentId, TaskId>;
  /**
   * 各エージェントの次の 1 歩。指定が無いエージェントはその場に留まる。
   * 隣接セルか現在地のみ許す。違反はループ側が弾く。
   */
  readonly moves: ReadonlyMap<AgentId, Cell>;
}

export interface MapdStrategy {
  readonly name: string;
  /** 実行前の準備。失敗したら理由を返す。 */
  init?(scenario: Scenario, endpoints: MapdEndpoints): string | null;
  step(input: MapdStepInput): MapdStepOutput;
}

export interface MapdLoopOptions {
  /** 何ステップ回すか。既定はマップ面積とタスク数から決める。 */
  readonly horizon?: number;
  /** well-formed でない入力を拒否するか。既定 false（警告のみ）。 */
  readonly requireWellFormed?: boolean;
}

export interface MapdRunResult {
  readonly result: SolverResult;
}

export async function runMapdLoop(
  scenario: Scenario,
  options: SolverOptions,
  context: SolverContext,
  strategy: MapdStrategy,
  loopOptions: MapdLoopOptions = {},
): Promise<SolverResult> {
  const startedAt = context.now();
  const recorder = createTraceRecorder(options);
  const warnings: SolverWarning[] = [];
  const emit = (event: SolverEvent): void => {
    recorder.record(event);
    context.emit(event);
  };
  const finish = (result: SolverResult): SolverResult => {
    const all = [...warnings, ...(result.warnings ?? []), ...recorder.warnings];
    const out: SolverResult = {
      ...result,
      ...(all.length ? { warnings: all } : {}),
      ...(recorder.events.length ? { trace: recorder.events } : {}),
    };
    emit({ type: "finish", result: out });
    return out;
  };

  const limits = checkLimits(scenario, options);
  warnings.push(...limits.warnings);
  if (!limits.ok) return finish(limits.result!);
  if (scenario.kind !== "mapd") {
    return finish(
      errorResult(startedAt, context, "MAPD の Scenario にのみ対応します。", "unsupported-rules"),
    );
  }
  const tasks = scenario.tasks ?? [];
  if (tasks.length === 0) {
    return finish(
      errorResult(startedAt, context, "タスクが 1 件もありません。", "invalid-scenario"),
    );
  }

  /*
    ★ well-formed かどうかは必ず伝える。
      TP / TPTS の保証（同 p.4 Theorem 3「All well-formed MAPD instances are
      solvable, and TP solves them.」）は well-formed が前提なので、
      そうでない入力での失敗を手法の欠陥と読まれると誤り。
      逆に well-formed は十分条件であって必要条件ではない（同 p.2）ので、
      「well-formed でない = 解けない」とも言わない。
  */
  const wf = checkWellFormed(scenario);
  if (!wf.checked) {
    warnings.push({
      code: "simplified-behavior",
      message:
        "endpoint が多いため、well-formed かどうかの条件 (c) を検査していません。この実行は理論保証の対象かどうか判定できていません。",
    });
  } else if (!wf.wellFormed) {
    if (loopOptions.requireWellFormed) {
      return finish(
        errorResult(
          startedAt,
          context,
          `well-formed ではありません。${wf.violations.join(" / ")}`,
          "invalid-scenario",
        ),
      );
    }
    warnings.push({
      code: "simplified-behavior",
      message:
        `この入力は well-formed ではありません（${wf.violations[0]}）。` +
        "well-formed は解けるための十分条件であって必要条件ではないので、解けないと決まったわけではありません。ただし TP / TPTS の理論保証（mapd-tp-tpts-central-2017 p.4 Theorem 3）は well-formed な入力についての主張なので、この実行はその対象外です。",
    });
  }

  const endpoints = wf.endpoints;
  const initError = strategy.init?.(scenario, endpoints);
  if (initError) {
    return finish(errorResult(startedAt, context, initError, "invalid-scenario"));
  }

  const horizon = Math.min(
    options.maxHorizon,
    loopOptions.horizon ?? options.horizon ?? defaultMapdHorizon(scenario),
  );

  const positions = new Map<AgentId, Cell>(scenario.agents.map((a) => [a.id, { ...a.start }]));
  const histories = new Map<AgentId, { time: number; cell: Cell }[]>(
    scenario.agents.map((a) => [a.id, [{ time: 0, cell: { ...a.start } }]]),
  );
  const byRelease = [...tasks].sort(
    (a, b) => a.releaseTime - b.releaseTime || (a.id < b.id ? -1 : 1),
  );
  const pending = new Map<TaskId, TaskSpec>();
  const carrying = new Map<AgentId, { task: TaskSpec; pickedUp: boolean }>();
  const serviceTimes: number[] = [];
  let released = 0;
  let completed = 0;
  let outcome: SolverResult["outcome"] = "solved";

  for (let time = 1; time <= horizon; time += 1) {
    const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
    if (abort !== "ok") {
      outcome = abort;
      break;
    }

    // 1. その時刻に現れるタスクを task set へ入れる。
    while (released < byRelease.length && byRelease[released]!.releaseTime <= time - 1) {
      const task = byRelease[released]!;
      pending.set(task.id, task);
      emit({ type: "release-task", taskId: task.id, time: task.releaseTime });
      released += 1;
    }

    // 2. 戦略に尋ねる。
    const openTasks = [...pending.values()].filter(
      (task) => ![...carrying.values()].some((c) => c.task.id === task.id),
    );
    const step = strategy.step({
      scenario,
      time: time - 1,
      positions,
      openTasks,
      carrying,
      endpoints,
      emit,
    });
    for (const [agentId, taskId] of step.assign ?? []) {
      const task = pending.get(taskId);
      if (!task || carrying.has(agentId)) continue;
      carrying.set(agentId, { task, pickedUp: false });
    }

    // 3. 1 歩進める。隣接でない指定はその場待機に落とす。
    const moved: Record<string, Cell> = {};
    for (const agent of scenario.agents) {
      const current = positions.get(agent.id)!;
      const requested = step.moves.get(agent.id);
      const next = requested && isStepValid(scenario, current, requested) ? requested : current;
      positions.set(agent.id, { ...next });
      histories.get(agent.id)!.push({ time, cell: { ...next } });
      moved[agent.id] = { ...next };
    }
    emit({ type: "move", time, positions: moved });

    // 4. pickup / delivery を判定する。
    for (const agent of scenario.agents) {
      const held = carrying.get(agent.id);
      if (!held) continue;
      const at = positions.get(agent.id)!;
      if (!held.pickedUp && cellEquals(at, held.task.pickup)) {
        carrying.set(agent.id, { task: held.task, pickedUp: true });
        emit({ type: "pickup", taskId: held.task.id, agentId: agent.id, time });
        continue;
      }
      if (held.pickedUp && cellEquals(at, held.task.delivery)) {
        carrying.delete(agent.id);
        pending.delete(held.task.id);
        completed += 1;
        // service time は「task set に入ってから完了まで」（同 p.2 §3.1）。
        serviceTimes.push(time - held.task.releaseTime);
        emit({ type: "delivery", taskId: held.task.id, agentId: agent.id, time });
        emit({
          type: "progress",
          ratio: completed / tasks.length,
          label: `${completed}/${tasks.length} 件を配達`,
        });
      }
    }

    if (completed === tasks.length) break;
  }

  const paths: TimedPath[] = scenario.agents.map((agent) => ({
    agentId: agent.id,
    positions: histories.get(agent.id)!.map((p) => ({ time: p.time, cell: p.cell })),
  }));
  const remaining = tasks.length - completed;
  if (remaining > 0 && outcome === "solved") outcome = "timeout";

  const conflicts = detectConflicts(paths, scenario.rules);
  const runtimeMs = context.now() - startedAt;
  const span = Math.max(1, makespanOf(paths));
  return finish({
    outcome,
    paths,
    metrics: {
      sumOfCosts: sumOfCosts(paths),
      makespan: makespanOf(paths),
      runtimeMs,
      expandedNodes: 0,
      ...(serviceTimes.length
        ? { averageServiceTime: serviceTimes.reduce((s, v) => s + v, 0) / serviceTimes.length }
        : {}),
      throughput: completed / span,
      pendingTasks: remaining,
    },
    conflicts,
    ...(remaining > 0 ? { failureReason: "limit-exceeded" as const } : {}),
  });
}

/**
 * 既定の実行ステップ数。
 *
 * ★ タスクの最終 release 時刻を必ず含めること。含めないと、まだ現れて
 *   いないタスクを「未処理」と数えてしまう。そのうえでマップ面積ぶんの
 *   余裕を足す。
 */
function defaultMapdHorizon(scenario: Scenario): number {
  const lastRelease = (scenario.tasks ?? []).reduce((max, t) => Math.max(max, t.releaseTime), 0);
  const area = scenario.map.width * scenario.map.height;
  return lastRelease + Math.max(64, area);
}

/**
 * 戦略が返した 1 歩が妥当か。
 *
 * ★ ここで弾くのは「隣接でも現在地でもない移動」だけ。衝突は弾かない。
 *   衝突を避けるのは戦略の仕事で、避けられなかったことは結果の
 *   conflicts に出す。ループ側が黙って直すと、不完全な手法が
 *   完全であるかのように見えてしまう。
 */
function isStepValid(scenario: Scenario, from: Cell, to: Cell): boolean {
  if (cellEquals(from, to)) return true;
  return neighbors(scenario.map, from, scenario.rules).some((cell) => cellEquals(cell, to));
}

function errorResult(
  startedAt: number,
  context: SolverContext,
  message: string,
  code: "invalid-scenario" | "unsupported-rules",
): SolverResult {
  return {
    outcome: "error",
    paths: [],
    metrics: { sumOfCosts: 0, makespan: 0, runtimeMs: context.now() - startedAt, expandedNodes: 0 },
    conflicts: [],
    error: { code, message },
    failureReason: code === "unsupported-rules" ? "unsupported-rules" : "internal",
  };
}

export { endpointsOf };
