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
import { cellEquals, lookupDistance, neighbors, trueDistanceFrom } from "@/lib/model/grid.js";
import { detectConflicts, makespanOf, sumOfCosts } from "@/lib/model/conflicts.js";
import { checkWellFormed, endpointsOf, taskGoals, type MapdEndpoints } from "@/lib/model/mapd.js";
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

/** 容量制約付き MAPD の一つの carrying 状態。 */
export interface CarryingTaskState {
  readonly task: TaskSpec;
  readonly pickedUp: boolean;
  readonly goalIndex: number;
}

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
  /** 容量制約付き MAPD 用の完全な carrying 状態。旧戦略では未設定。 */
  readonly carryingTasks?: ReadonlyMap<AgentId, readonly CarryingTaskState[]>;
  /** 論文 §3.2 の endpoint 集合。TP の Path2 が non-task endpoint を要る。 */
  readonly endpoints: MapdEndpoints;
  readonly emit: (event: SolverEvent) => void;
}

/** 戦略がその時刻に決めたこと。 */
export interface MapdStepOutput {
  /**
   * 割り当て。agentId -> taskId。
   *
   * ★ **他のエージェントが持っているタスクを奪える。** ただし持ち主が
   *   まだ pickup へ向かっている途中（`pickedUp === false`）の場合だけ。
   *   これは TPTS の定義そのもので（mapd-tp-tpts-central-2017 p.4 §4.2）、
   *
   *     「an agent with the token can assign itself not only to a task that
   *       has no agent assigned but also to a task that is already assigned
   *       another agent **as long as that agent is still moving to the
   *       pickup location** of the task」
   *
   *   pickup 済みのタスクを奪う指定はループ側が黙って無視する。
   *   論文が禁じている操作を戦略側の書き方次第で通してしまわないよう、
   *   条件の判定はここ 1 箇所に置く。
   *
   * ★ 奪われた側は手が空く。ループは `swap-task` イベントを出すので、
   *   戦略はそれか次ステップの `carrying` を見て、古い計画を捨てること。
   *   ループは戦略の内部状態を知らないので、計画の破棄まではやらない。
   */
  readonly assign?: ReadonlyMap<AgentId, TaskId>;
  /** MG-MAPD / 容量制約向けの task 列。 */
  readonly assignSequence?: ReadonlyMap<AgentId, readonly TaskId[]>;
  /**
   * 割り当てを解く。ここに挙げたエージェントは手が空く。
   * pickup 済みのタスクは解けない（運搬中のものを捨てさせないため）。
   */
  readonly unassign?: readonly AgentId[];
  /**
   * 各エージェントの次の 1 歩。指定が無いエージェントはその場に留まる。
   * 隣接セルか現在地のみ許す。違反はループ側が弾く。
   */
  readonly moves: ReadonlyMap<AgentId, Cell>;
}

export interface MapdStrategy {
  readonly name: string;
  /** 複数 task / goal 列を扱う戦略だけ true にする。 */
  readonly extendedModel?: boolean;
  /** 戦略内部で実測した展開数。 */
  readonly expandedNodes?: number;
  /** 戦略側で探索を止めた理由。 */
  readonly stopReason?: "timeout" | "node-limit" | "aborted";
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

  if (
    strategy.extendedModel === true ||
    scenario.agents.some((agent) => (agent.capacity ?? 1) > 1) ||
    tasks.some((task) => (task.goals?.length ?? 0) > 0)
  ) {
    return runExtendedMapdLoop(
      scenario,
      options,
      context,
      strategy,
      startedAt,
      horizon,
      emit,
      finish,
    );
  }

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
    /*
      ★ 割当の解除を先に処理する。順序を逆にすると、同じステップで
        「a から外して b へ渡す」を書いたときに解除が後勝ちして消える。
    */
    for (const agentId of step.unassign ?? []) {
      const held = carrying.get(agentId);
      // 運搬中のものは捨てさせない。pickup 済みは解除できない。
      if (!held || held.pickedUp) continue;
      carrying.delete(agentId);
    }
    for (const [agentId, taskId] of step.assign ?? []) {
      const task = pending.get(taskId);
      if (!task || carrying.has(agentId)) continue;
      /*
        ★ 他のエージェントが持っているタスクなら、TPTS の条件を満たすときだけ奪う
          （同 p.4 §4.2「as long as that agent is still moving to the pickup
          location」）。pickup 済みなら奪えない。ここで弾くことで、
          戦略の書き方に関わらず論文の条件が守られる。
      */
      const currentOwner = [...carrying.entries()].find(([, c]) => c.task.id === taskId);
      if (currentOwner) {
        const [ownerId, held] = currentOwner;
        if (held.pickedUp || ownerId === agentId) continue;
        carrying.delete(ownerId);
        emit({ type: "swap-task", taskId, from: ownerId, to: agentId, time });
      }
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

/**
 * MG-MAPD / capacity 拡張用の実行ループ。
 * 既存モデルの分岐には入らないため、容量 1・単一 goal の旧手法の挙動を
 * 変更しない。時刻順序は通常ループと同じ release → strategy → move → service。
 */
async function runExtendedMapdLoop(
  scenario: Scenario,
  options: SolverOptions,
  context: SolverContext,
  strategy: MapdStrategy,
  startedAt: number,
  horizon: number,
  emit: (event: SolverEvent) => void,
  finish: (result: SolverResult) => SolverResult,
): Promise<SolverResult> {
  const tasks = scenario.tasks ?? [];
  const byRelease = [...tasks].sort(
    (a, b) => a.releaseTime - b.releaseTime || (a.id < b.id ? -1 : 1),
  );
  const pending = new Map<TaskId, TaskSpec>();
  const positions = new Map<AgentId, Cell>(scenario.agents.map((a) => [a.id, { ...a.start }]));
  const histories = new Map<AgentId, { time: number; cell: Cell }[]>(
    scenario.agents.map((a) => [a.id, [{ time: 0, cell: { ...a.start } }]]),
  );
  const carrying = new Map<AgentId, CarryingTaskState[]>();
  const serviceTimes: number[] = [];
  const completionTimes = new Map<TaskId, number>();
  let released = 0;
  let completed = 0;
  let outcome: SolverResult["outcome"] = "solved";

  for (let time = 1; time <= horizon; time += 1) {
    const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
    if (abort !== "ok") {
      outcome = abort;
      break;
    }
    while (released < byRelease.length && byRelease[released]!.releaseTime <= time - 1) {
      const task = byRelease[released]!;
      pending.set(task.id, task);
      emit({ type: "release-task", taskId: task.id, time: task.releaseTime });
      released += 1;
    }

    const legacy = new Map<AgentId, { task: TaskSpec; pickedUp: boolean }>();
    for (const [agentId, states] of carrying) {
      const first = states[0];
      if (first) legacy.set(agentId, { task: first.task, pickedUp: first.pickedUp });
    }
    const assignedIds = new Set<TaskId>();
    for (const states of carrying.values())
      for (const state of states) assignedIds.add(state.task.id);
    const openTasks = [...pending.values()].filter((task) => !assignedIds.has(task.id));
    const step = strategy.step({
      scenario,
      time: time - 1,
      positions,
      openTasks,
      carrying: legacy,
      carryingTasks: carrying,
      endpoints: endpointsOf(scenario),
      emit,
    });
    if (strategy.stopReason) {
      outcome = strategy.stopReason;
      break;
    }

    for (const agentId of step.unassign ?? []) {
      const states = carrying.get(agentId);
      if (!states) continue;
      const kept = states.filter((state) => state.pickedUp);
      if (kept.length) carrying.set(agentId, kept);
      else carrying.delete(agentId);
    }
    const ownerOf = (taskId: TaskId): [AgentId, CarryingTaskState] | undefined => {
      for (const [agentId, states] of carrying) {
        const state = states.find((candidate) => candidate.task.id === taskId);
        if (state) return [agentId, state];
      }
      return undefined;
    };
    const addTask = (agentId: AgentId, taskId: TaskId): void => {
      const task = pending.get(taskId);
      if (!task) return;
      const current = carrying.get(agentId) ?? [];
      if (current.some((state) => state.task.id === taskId)) return;
      const owner = ownerOf(taskId);
      if (owner) {
        if (owner[1].pickedUp || owner[0] === agentId) return;
        const old = carrying.get(owner[0]) ?? [];
        carrying.set(
          owner[0],
          old.filter((state) => state.task.id !== taskId),
        );
        if ((carrying.get(owner[0]) ?? []).length === 0) carrying.delete(owner[0]);
        emit({ type: "swap-task", taskId, from: owner[0], to: agentId, time });
      }
      carrying.set(agentId, [...current, { task, pickedUp: false, goalIndex: 0 }]);
      emit({ type: "assign-task", taskId, agentId });
    };
    for (const [agentId, sequence] of step.assignSequence ?? []) {
      for (const taskId of sequence) addTask(agentId, taskId);
    }
    for (const [agentId, taskId] of step.assign ?? []) addTask(agentId, taskId);

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

    for (const agent of scenario.agents) {
      const states = carrying.get(agent.id);
      if (!states || states.length === 0) continue;
      const at = positions.get(agent.id)!;
      const capacity = Math.max(1, agent.capacity ?? 1);
      let picked = states.filter((state) => state.pickedUp).length;
      const nextStates = states.map((state) => ({ ...state }));
      for (let index = 0; index < nextStates.length; index += 1) {
        const state = nextStates[index]!;
        if (state.pickedUp || picked >= capacity) continue;
        if (index !== 0 && !nextStates[index - 1]!.pickedUp) break;
        if (!cellEquals(at, state.task.pickup)) break;
        nextStates[index] = { ...state, pickedUp: true, goalIndex: 0 };
        picked += 1;
        emit({ type: "pickup", taskId: state.task.id, agentId: agent.id, time });
      }
      const remaining: CarryingTaskState[] = [];
      for (const state of nextStates) {
        if (!state.pickedUp) {
          remaining.push(state);
          continue;
        }
        const goals = taskGoals(state.task);
        const goal = goals[state.goalIndex] ?? goals[goals.length - 1]!;
        if (!cellEquals(at, goal)) {
          remaining.push(state);
          continue;
        }
        if (state.goalIndex < goals.length - 1) {
          remaining.push({ ...state, goalIndex: state.goalIndex + 1 });
          continue;
        }
        pending.delete(state.task.id);
        completed += 1;
        completionTimes.set(state.task.id, time);
        serviceTimes.push(time - state.task.releaseTime);
        emit({ type: "delivery", taskId: state.task.id, agentId: agent.id, time });
        emit({
          type: "progress",
          ratio: completed / tasks.length,
          label: `${completed}/${tasks.length} 件を配達`,
        });
      }
      if (remaining.length) carrying.set(agent.id, remaining);
      else carrying.delete(agent.id);
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
  let totalTravelDelay = 0;
  for (const task of tasks) {
    const done = completionTimes.get(task.id);
    if (done === undefined) continue;
    const goals = taskGoals(task);
    let ideal = 0;
    let from = task.pickup;
    for (const goal of goals) {
      const field = trueDistanceFrom(scenario.map, goal);
      ideal += lookupDistance(scenario.map, field, from);
      from = goal;
    }
    if (Number.isFinite(ideal)) totalTravelDelay += done - (task.releaseTime + ideal);
  }
  return finish({
    outcome,
    paths,
    metrics: {
      sumOfCosts: sumOfCosts(paths),
      makespan: makespanOf(paths),
      runtimeMs,
      ...(strategy.expandedNodes !== undefined ? { expandedNodes: strategy.expandedNodes } : {}),
      ...(serviceTimes.length
        ? { averageServiceTime: serviceTimes.reduce((s, v) => s + v, 0) / serviceTimes.length }
        : {}),
      throughput: completed / span,
      pendingTasks: remaining,
      totalTravelDelay,
    },
    conflicts,
    ...(remaining > 0 ? { failureReason: "limit-exceeded" as const } : {}),
  });
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
