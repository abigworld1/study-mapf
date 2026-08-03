import type {
  AgentId,
  Cell,
  Scenario,
  SolverContext,
  SolverOptions,
  TaskId,
  TaskSpec,
  TimedPath,
} from "@/lib/model/types.js";
import { cellEquals, cellKey, lookupDistance, trueDistanceFrom } from "@/lib/model/grid.js";
import { buildReservationTable, reservePathForRules } from "@/lib/model/reservation.js";
import { taskGoals, type MapdEndpoints } from "@/lib/model/mapd.js";
import { spaceTimeAStar } from "../low-level/space-time-astar.js";
import type { CarryingTaskState, MapdStepInput, MapdStepOutput, MapdStrategy } from "./loop.js";
import { regretInsert } from "../../lib/assignment/regret-insertion.js";

export type Batch9Mode = "lns-pbs" | "lns-wpbs" | "rmca";

/**
 * Batch 9 の教育用 MAPD 戦略。
 *
 * LNS-PBS / wPBS は sequence assignment と順序付き時空間 A* を共有し、wPBS は
 * 窓内だけの予約を使って窓ごとに再計画する。
 * RMCA は同じ planner に regret insertion を組み合わせる。論文の大規模な
 * anytime 実装をそのまま再現するのではなく、ブラウザで動く決定的な骨格として
 * task sequence・capacity・multi-goal を可視化することを目的にしている。
 */
export class Batch9MapdStrategy implements MapdStrategy {
  readonly extendedModel = true;
  readonly name: string;
  private readonly plans = new Map<AgentId, TimedPath>();
  private readonly token = new Map<AgentId, TimedPath>();
  private readonly distanceCache = new Map<string, Float64Array>();
  private readonly nextReplanAt = new Map<AgentId, number>();
  private initializedTasks = new Set<TaskId>();
  private expandedTotal = 0;
  private stop: "timeout" | "node-limit" | "aborted" | undefined;

  get expandedNodes(): number {
    return this.expandedTotal;
  }

  get stopReason(): "timeout" | "node-limit" | "aborted" | undefined {
    return this.stop;
  }

  constructor(
    private readonly mode: Batch9Mode,
    private readonly options: SolverOptions,
    context: SolverContext,
  ) {
    this.name = mode;
    this.context = context;
    this.startedAt = context.now();
    this.windowSize = mode === "lns-wpbs" ? readWindowSize(options) : undefined;
  }

  private readonly context: SolverContext;
  private readonly startedAt: number;
  private readonly windowSize: number | undefined;

  init(scenario: Scenario, _endpoints: MapdEndpoints): string | null {
    if (this.mode === "lns-wpbs" && this.windowSize === undefined) {
      return "LNS-wPBS の extra.windowSize / planningWindow は 1 以上の整数で指定してください。";
    }
    this.plans.clear();
    this.token.clear();
    this.distanceCache.clear();
    this.nextReplanAt.clear();
    this.initializedTasks.clear();
    this.expandedTotal = 0;
    this.stop = undefined;
    for (const agent of scenario.agents) {
      const path: TimedPath = {
        agentId: agent.id,
        positions: [{ time: 0, cell: { ...agent.start } }],
      };
      this.token.set(agent.id, path);
    }
    return null;
  }

  step(input: MapdStepInput): MapdStepOutput {
    this.syncToken(input);
    const assignSequence = new Map<AgentId, readonly TaskId[]>();
    const moves = new Map<AgentId, Cell>();
    const carryingTasks = input.carryingTasks ?? new Map<AgentId, readonly CarryingTaskState[]>();
    const assigned = new Set<TaskId>();
    for (const states of carryingTasks.values())
      for (const state of states) assigned.add(state.task.id);

    const free = input.scenario.agents
      .filter((agent) => !carryingTasks.has(agent.id) && !this.plans.has(agent.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    const open = [...input.openTasks].filter((task) => !assigned.has(task.id));

    // New tasks are inserted into the shortest estimated route. RMCA uses the
    // regret-2 ordering; LNS-PBS uses deterministic round-robin insertion.
    if (open.length > 0 && free.length > 0) {
      input.emit({
        type: "select-neighborhood",
        agentIds: free.map((agent) => agent.id),
        strategy: this.mode,
      });
      const queues = new Map<AgentId, TaskId[]>(free.map((agent) => [agent.id, []]));
      const ordered =
        this.mode === "rmca"
          ? regretInsert(open, free, (task, agent) =>
              this.distanceTo(input.scenario, agent.id, task.pickup),
            )
          : open;
      for (const task of ordered) {
        const agent = [...queues.entries()].sort(
          (a, b) =>
            queueCost(input, a[0], a[1], open, this) - queueCost(input, b[0], b[1], open, this) ||
            a[0].localeCompare(b[0]),
        )[0]?.[0];
        if (!agent) break;
        queues.get(agent)!.push(task.id);
      }
      for (const [agentId, taskIds] of queues) {
        if (taskIds.length === 0) continue;
        const tasks = taskIds
          .map((id) => input.openTasks.find((task) => task.id === id))
          .filter((task): task is TaskSpec => task !== undefined);
        if (!this.planSequence(input, agentId, tasks, [])) continue;
        assignSequence.set(agentId, taskIds);
        for (const taskId of taskIds) this.initializedTasks.add(taskId);
      }
      input.emit({
        type: "repair-neighborhood",
        agentIds: free.map((agent) => agent.id),
      });
    }

    // Replan after a delivery, a task swap, or a window boundary.
    for (const agent of input.scenario.agents) {
      const current = input.positions.get(agent.id) ?? agent.start;
      const states = carryingTasks.get(agent.id) ?? [];
      const activeTasks = states.map((state) => state.task);
      const needsPlan =
        !this.plans.has(agent.id) ||
        this.planExpired(agent.id, input.time) ||
        (this.mode === "lns-wpbs" && input.time >= (this.nextReplanAt.get(agent.id) ?? 0));
      if (needsPlan && activeTasks.length > 0) {
        if (this.mode === "lns-wpbs" && this.plans.has(agent.id)) {
          input.emit({
            type: "replan",
            agentIds: [agent.id],
            reason: `wPBS window ${this.windowSize ?? 10} elapsed`,
          });
        }
        this.planSequence(input, agent.id, activeTasks, states);
      }
      const plan = this.plans.get(agent.id);
      const next = plan?.positions.find((position) => position.time === input.time + 1);
      moves.set(agent.id, next?.cell ?? current);
    }
    if (this.mode === "lns-wpbs") this.resolveWindowConflicts(input, moves);
    return { assignSequence, moves };
  }

  /**
   * wPBS executes only the first window of a plan. Replanning at the next
   * boundary normally prevents conflicts, but a plan that was shortened by a
   * previous wait can still propose a stale edge swap. Resolve only the next
   * executed move and force the affected agents to replan on the next step.
   */
  private resolveWindowConflicts(input: MapdStepInput, moves: Map<AgentId, Cell>): void {
    const agents = [...input.scenario.agents].sort((a, b) => a.id.localeCompare(b.id));
    for (let pass = 0; pass < agents.length; pass += 1) {
      let changed = false;
      for (let left = 0; left < agents.length; left += 1) {
        const a = agents[left]!;
        const aFrom = input.positions.get(a.id) ?? a.start;
        const aTo = moves.get(a.id) ?? aFrom;
        for (let right = left + 1; right < agents.length; right += 1) {
          const b = agents[right]!;
          const bFrom = input.positions.get(b.id) ?? b.start;
          const bTo = moves.get(b.id) ?? bFrom;
          const edgeSwap =
            input.scenario.rules.forbidEdgeSwap &&
            !cellEquals(aFrom, aTo) &&
            !cellEquals(bFrom, bTo) &&
            cellEquals(aFrom, bTo) &&
            cellEquals(bFrom, aTo);
          if (edgeSwap) {
            moves.set(a.id, { ...aFrom });
            moves.set(b.id, { ...bFrom });
            this.forceReplan(a.id, input.time + 1);
            this.forceReplan(b.id, input.time + 1);
            changed = true;
            continue;
          }
          if (!cellEquals(aTo, bTo)) continue;
          // Keep an agent already occupying the shared destination there and
          // make the other agent wait; otherwise make the lower priority agent
          // wait. IDs provide the deterministic priority tie-break.
          const waitId = cellEquals(aFrom, aTo) ? b.id : cellEquals(bFrom, bTo) ? a.id : b.id;
          const waitFrom = input.positions.get(waitId)!;
          moves.set(waitId, { ...waitFrom });
          this.forceReplan(waitId, input.time + 1);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  private forceReplan(agentId: AgentId, at: number): void {
    this.plans.delete(agentId);
    this.nextReplanAt.set(agentId, at);
  }

  private syncToken(input: MapdStepInput): void {
    for (const agent of input.scenario.agents) {
      const current = input.positions.get(agent.id) ?? agent.start;
      const old = this.token.get(agent.id);
      const future = old?.positions.filter((position) => position.time > input.time) ?? [];
      this.token.set(agent.id, {
        agentId: agent.id,
        positions: [{ time: input.time, cell: { ...current } }, ...future],
      });
      const plan = this.plans.get(agent.id);
      if (plan && !plan.positions.some((position) => position.time > input.time)) {
        this.plans.delete(agent.id);
        this.nextReplanAt.delete(agent.id);
      }
    }
  }

  private planExpired(agentId: AgentId, time: number): boolean {
    const plan = this.plans.get(agentId);
    return !plan || (plan.positions[plan.positions.length - 1]?.time ?? time) <= time;
  }

  private planSequence(
    input: MapdStepInput,
    agentId: AgentId,
    tasks: readonly TaskSpec[],
    states: readonly CarryingTaskState[],
  ): boolean {
    const start = input.positions.get(agentId);
    if (!start) return false;
    const others = [...this.token.entries()]
      .filter(([id]) => id !== agentId)
      .map(([, path]) => path);
    // wPBS keeps the search horizon long enough to reach the goal. The window
    // limits only reservations and collision checks, never goal reachability.
    const searchEnd =
      input.time +
      Math.min(
        this.options.maxHorizon,
        Math.max(64, input.scenario.map.width * input.scenario.map.height * 2),
      );
    const windowEnd =
      this.mode === "lns-wpbs"
        ? Math.min(searchEnd, input.time + (this.windowSize ?? 10))
        : searchEnd;
    const reservationPaths =
      this.mode === "lns-wpbs" ? others.map((path) => truncatePath(path, windowEnd)) : others;
    const reservation = buildReservationTable(reservationPaths, windowEnd, input.scenario.rules);
    const pieces: { cell: Cell; time: number }[] = [{ cell: { ...start }, time: input.time }];
    let from = start;
    let time = input.time;
    const actionGroups: Cell[][] = [];
    if (this.mode === "rmca") {
      const capacity = Math.max(
        1,
        input.scenario.agents.find((agent) => agent.id === agentId)?.capacity ?? 1,
      );
      for (let offset = 0; offset < tasks.length; offset += capacity) {
        const group = tasks.slice(offset, offset + capacity);
        const groupStates = states.slice(offset, offset + capacity);
        const actions: Cell[] = [];
        for (let index = 0; index < group.length; index += 1) {
          if (!groupStates[index]?.pickedUp) actions.push(group[index]!.pickup);
        }
        for (let index = 0; index < group.length; index += 1) {
          const task = group[index]!;
          const state = groupStates[index];
          const goals = taskGoals(task);
          const firstGoal = state?.pickedUp ? state.goalIndex : 0;
          for (let goalIndex = firstGoal; goalIndex < goals.length; goalIndex += 1)
            actions.push(goals[goalIndex]!);
        }
        actionGroups.push(actions);
      }
    } else {
      for (let index = 0; index < tasks.length; index += 1) {
        const task = tasks[index]!;
        const state = states[index];
        const actions: Cell[] = [];
        if (!state?.pickedUp) actions.push(task.pickup);
        const goals = taskGoals(task);
        const firstGoal = state?.pickedUp ? state.goalIndex : 0;
        for (let goalIndex = firstGoal; goalIndex < goals.length; goalIndex += 1)
          actions.push(goals[goalIndex]!);
        actionGroups.push(actions);
      }
    }
    for (const targets of actionGroups)
      for (const target of targets) {
        if (this.context.signal.aborted) return false;
        const result = spaceTimeAStar({
          map: input.scenario.map,
          start: from,
          goal: target,
          agentId,
          rules: input.scenario.rules,
          reservations: reservation,
          reservationHorizon: windowEnd,
          startTime: time,
          maxTime: searchEnd,
          maxExpansions: Math.max(1, this.options.maxExpansions),
          consumeExpansion: () => {
            if (this.context.signal.aborted) {
              this.stop = "aborted";
              return "aborted";
            }
            if (this.context.now() - this.startedAt > this.options.timeoutMs) {
              this.stop = "timeout";
              return "timeout";
            }
            if (this.expandedTotal >= this.options.maxExpansions) {
              this.stop = "node-limit";
              return "max-expansions";
            }
            this.expandedTotal += 1;
            return "ok";
          },
          heuristic: this.distanceField(input.scenario, target),
          onExpand: (cell, at) =>
            input.emit({
              type: "expand-node",
              agentId,
              state: { algorithm: this.mode, cell, time: at },
            }),
        });
        if (!result.path) return false;
        for (const position of result.path.positions.slice(1))
          pieces.push({ cell: position.cell, time: position.time });
        from = target;
        time = result.path.positions[result.path.positions.length - 1]!.time;
        reservePathForRules(
          reservation,
          this.mode === "lns-wpbs" ? truncatePath(result.path, windowEnd) : result.path,
          windowEnd,
          input.scenario.rules,
        );
      }
    const endpoint = this.chooseEndpoint(input, agentId, from);
    if (endpoint && !cellEquals(from, endpoint)) {
      const result = spaceTimeAStar({
        map: input.scenario.map,
        start: from,
        goal: endpoint,
        agentId,
        rules: input.scenario.rules,
        reservations: reservation,
        reservationHorizon: windowEnd,
        startTime: time,
        maxTime: searchEnd,
        maxExpansions: Math.max(1, this.options.maxExpansions),
        consumeExpansion: () => {
          if (this.context.signal.aborted) {
            this.stop = "aborted";
            return "aborted";
          }
          if (this.context.now() - this.startedAt > this.options.timeoutMs) {
            this.stop = "timeout";
            return "timeout";
          }
          if (this.expandedTotal >= this.options.maxExpansions) {
            this.stop = "node-limit";
            return "max-expansions";
          }
          this.expandedTotal += 1;
          return "ok";
        },
        heuristic: this.distanceField(input.scenario, endpoint),
      });
      if (result.path) {
        for (const position of result.path.positions.slice(1))
          pieces.push({ cell: position.cell, time: position.time });
        reservePathForRules(
          reservation,
          this.mode === "lns-wpbs" ? truncatePath(result.path, windowEnd) : result.path,
          windowEnd,
          input.scenario.rules,
        );
      }
    }
    const path: TimedPath = { agentId, positions: pieces.map((position) => ({ ...position })) };
    this.plans.set(agentId, path);
    this.token.set(agentId, path);
    if (this.mode === "lns-wpbs")
      this.nextReplanAt.set(agentId, input.time + (this.windowSize ?? 10));
    input.emit({ type: "update-token", agentId, time: input.time });
    return true;
  }

  private chooseEndpoint(input: MapdStepInput, agentId: AgentId, from: Cell): Cell | undefined {
    const occupied = new Set<string>();
    for (const [id, path] of this.token) {
      if (id === agentId) continue;
      const last = path.positions[path.positions.length - 1];
      if (last) occupied.add(cellKey(last.cell));
    }
    const taskCells = new Set(input.endpoints.task.map(cellKey));
    return input.endpoints.nonTask
      .filter((cell) => !occupied.has(cellKey(cell)) && !taskCells.has(cellKey(cell)))
      .sort(
        (a, b) =>
          this.distanceTo(input.scenario, agentId, a, from) -
            this.distanceTo(input.scenario, agentId, b, from) ||
          cellKey(a).localeCompare(cellKey(b)),
      )[0];
  }

  private distanceField(scenario: Scenario, goal: Cell): Float64Array {
    const key = cellKey(goal);
    let field = this.distanceCache.get(key);
    if (!field) {
      field = trueDistanceFrom(scenario.map, goal);
      this.distanceCache.set(key, field);
    }
    return field;
  }

  distanceTo(scenario: Scenario, agentId: AgentId, goal: Cell, from?: Cell): number {
    const origin = from ?? scenario.agents.find((agent) => agent.id === agentId)?.start;
    if (!origin) return Number.POSITIVE_INFINITY;
    return lookupDistance(scenario.map, this.distanceField(scenario, goal), origin);
  }
}

function queueCost(
  input: MapdStepInput,
  agentId: AgentId,
  queue: readonly TaskId[],
  tasks: readonly TaskSpec[],
  strategy: Batch9MapdStrategy,
): number {
  const last = queue[queue.length - 1];
  const task = tasks.find((candidate) => candidate.id === last);
  return task
    ? strategy.distanceTo(input.scenario, agentId, task.pickup) + queue.length * 0.01
    : queue.length;
}

function readWindowSize(options: SolverOptions): number | undefined {
  // mg-mapd-iros-2022 p.6 reports w=10 for LNS-wPBS experiments. The explicit
  // windowSize option takes precedence; planningWindow is accepted for RHCR
  // compatibility with the existing simulator controls.
  const raw = options.extra?.windowSize ?? options.extra?.planningWindow ?? 10;
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0
    ? Math.min(raw, options.maxHorizon)
    : undefined;
}

function truncatePath(path: TimedPath, endTime: number): TimedPath {
  return {
    agentId: path.agentId,
    positions: path.positions.filter((position) => position.time <= endTime),
  };
}

export function createLnsPbsStrategy(options: SolverOptions, context: SolverContext): MapdStrategy {
  return new Batch9MapdStrategy("lns-pbs", options, context);
}

export function createLnsWpbsStrategy(
  options: SolverOptions,
  context: SolverContext,
): MapdStrategy {
  return new Batch9MapdStrategy("lns-wpbs", options, context);
}

export function createRmcaStrategy(options: SolverOptions, context: SolverContext): MapdStrategy {
  return new Batch9MapdStrategy("rmca", options, context);
}
