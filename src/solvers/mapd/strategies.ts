import type {
  AgentId,
  Cell,
  SolverContext,
  SolverOptions,
  TaskId,
  TaskSpec,
  TimedPath,
} from "@/lib/model/types.js";
import { cellEquals, cellKey, trueDistanceFrom } from "@/lib/model/grid.js";
import { positionAt } from "@/lib/model/conflicts.js";
import { hungarianMethod } from "@/lib/assignment/hungarian.js";
import { mlaStar } from "./mla-star.js";
import type { MapdEndpoints } from "@/lib/model/mapd.js";
import type { MapdStepInput, MapdStepOutput, MapdStrategy } from "./loop.js";

export type MapdStrategyMode = "tp" | "tpts" | "central" | "hbh";

interface Token {
  readonly paths: Map<AgentId, TimedPath>;
  readonly assignments: Map<TaskId, AgentId>;
}

interface Candidate {
  readonly task: TaskSpec;
  readonly distance: number;
}

/**
 * TP / TPTS / CENTRAL / HBH の共通 token 実装。
 *
 * token は予約表の別名ではなく、agent ごとの未来経路と task assignment を
 * そのまま保持する。各低レベル経路は MLA* が token の経路を直接照合する。
 */
export class TokenMapdStrategy implements MapdStrategy {
  readonly name: string;
  private readonly token: Token = { paths: new Map(), assignments: new Map() };
  private readonly distanceCache = new Map<string, Float64Array>();
  private readonly startedAt: number;
  private expanded = 0;

  constructor(
    private readonly mode: MapdStrategyMode,
    private readonly options: SolverOptions,
    private readonly context: SolverContext,
  ) {
    this.name = mode;
    this.startedAt = context.now();
  }

  init(
    scenario: Parameters<NonNullable<MapdStrategy["init"]>>[0],
    _endpoints: MapdEndpoints,
  ): string | null {
    this.token.paths.clear();
    this.token.assignments.clear();
    this.distanceCache.clear();
    this.expanded = 0;
    for (const agent of scenario.agents) {
      this.token.paths.set(agent.id, {
        agentId: agent.id,
        positions: [{ time: 0, cell: { ...agent.start } }],
      });
    }
    return null;
  }

  step(input: MapdStepInput): MapdStepOutput {
    this.synchronize(input);
    this.normalizePaths(input);

    const assign = new Map<AgentId, TaskId>();
    const assignedThisStep = new Set<AgentId>();
    const provisional = new Map<TaskId, AgentId>();
    const free = input.scenario.agents
      .filter((agent) => !input.carrying.has(agent.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    // Path2 は task assignment より先に適用する。delivery endpoint にいる
    // free agent がそのまま新しい task を取りに行くと、別 agent が向かう
    // delivery を塞いだまま token に残るためである。
    const path2BeforeAssignment = new Set<AgentId>();
    for (const agent of free) {
      if (!this.needsPath2(input, agent.id)) continue;
      const endpoint = this.closestFreeEndpoint(input, agent.id);
      if (endpoint && this.planEndpoint(input, agent.id, endpoint)) {
        path2BeforeAssignment.add(agent.id);
      }
    }
    const tasks = [...input.openTasks].sort(
      (a, b) => a.releaseTime - b.releaseTime || a.id.localeCompare(b.id),
    );
    // TPTS の task set は「未実行タスク」全体。openTasks だけでは、前の
    // timestep に別 agent が pickup へ向かい始めたタスクを奪えない。
    const candidateTasks = this.tasksForMode(input, tasks);
    const preferred =
      this.mode === "hbh" || this.mode === "central"
        ? this.hungarianPreferences(input, free, tasks)
        : new Map<AgentId, TaskId>();

    // TPTS で task を奪われた owner は、同じ timestep のうちに再び token を
    // 受け取り、新しい task を試せる。Map の挿入順を「奪う側 → 解放された側」
    // に保つことで、loop が先に old owner を carrying から外し、その後の
    // old owner の assign を受け付けられる（loop 側が swap-task を発火する）。
    const queue = [...free];
    const freedBySteal = new Set<AgentId>();
    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
      const agent = queue[queueIndex];
      if (!agent || assignedThisStep.has(agent.id)) continue;
      if (input.carrying.has(agent.id) && !freedBySteal.has(agent.id)) continue;
      if (path2BeforeAssignment.has(agent.id)) continue;
      const candidates = this.candidates(input, agent.id, candidateTasks, preferred.get(agent.id));
      for (const candidate of candidates) {
        const currentOwner =
          provisional.get(candidate.task.id) ?? this.token.assignments.get(candidate.task.id);
        if (currentOwner !== undefined && currentOwner !== agent.id) {
          if (this.mode !== "tpts") continue;
          const oldDistance = this.distanceTo(input, currentOwner, candidate.task.pickup);
          if (candidate.distance >= oldDistance) continue;
          const oldPath = this.token.paths.get(currentOwner);
          /*
            ★ old owner は loop で carrying から外れるので、pickup へ向かう
              古い経路は捨てる。ただし **token から消してはいけない。**

              消すと、この timestep に後から計画する agent からは old owner が
              居ないものとして見え、その居場所を通る経路を引いてしまう。
              old owner が新しい task を取れなければその場に留まるので、
              実際には重なる。well-formed な 114 例を回すと、TPTS だけ
              11 例で「解が求まりました」なのに衝突が残っていた。

              正しい最小状態は「いまの場所に留まり続ける」。そう置いてから
              新 owner を計画すれば、新 owner はそこを避ける。避けられない
              なら奪取そのものを見送る（奪えないより、衝突するほうが悪い）。
              old owner が同じ timestep に別 task を取れば、この resting path は
              planTask が上書きする。
          */
          const owner = currentOwner;
          const restingAt = input.positions.get(owner);
          this.token.paths.set(owner, {
            agentId: owner,
            positions: [
              { time: input.time, cell: { ...(restingAt ?? input.scenario.agents[0]!.start) } },
            ],
          });
          const planned = this.planTask(input, agent.id, candidate.task);
          if (!planned) {
            if (oldPath) this.token.paths.set(currentOwner, oldPath);
            else this.token.paths.delete(currentOwner);
            continue;
          }
          provisional.delete(candidate.task.id);
          provisional.set(candidate.task.id, agent.id);
          assign.delete(currentOwner);
          assign.set(agent.id, candidate.task.id);
          this.token.assignments.set(candidate.task.id, agent.id);
          input.emit({ type: "assign-task", taskId: candidate.task.id, agentId: agent.id });
          assignedThisStep.add(agent.id);
          freedBySteal.add(currentOwner);
          queue.push(
            input.scenario.agents.find((candidateAgent) => candidateAgent.id === currentOwner)!,
          );
          break;
        }
        if (currentOwner !== undefined) continue;
        const planned = this.planTask(input, agent.id, candidate.task);
        if (!planned) continue;
        provisional.set(candidate.task.id, agent.id);
        assign.set(agent.id, candidate.task.id);
        assignedThisStep.add(agent.id);
        this.token.assignments.set(candidate.task.id, agent.id);
        input.emit({ type: "assign-task", taskId: candidate.task.id, agentId: agent.id });
        break;
      }
    }

    // TP Path2: delivery endpoint 上で task endpoint を塞ぐ free agent を退避させる。
    const path2Agents = new Map(queue.map((agent) => [agent.id, agent]));
    for (const agent of path2Agents.values()) {
      if (path2BeforeAssignment.has(agent.id)) continue;
      if (
        assignedThisStep.has(agent.id) ||
        (input.carrying.has(agent.id) && !freedBySteal.has(agent.id))
      )
        continue;
      if (!freedBySteal.has(agent.id) && !this.needsPath2(input, agent.id)) continue;
      const endpoint = this.closestFreeEndpoint(input, agent.id);
      if (endpoint) this.planEndpoint(input, agent.id, endpoint);
    }

    const moves = new Map<AgentId, Cell>();
    for (const agent of input.scenario.agents) {
      const current = input.positions.get(agent.id) ?? agent.start;
      const path = this.token.paths.get(agent.id);
      const next = path ? positionAt(path, input.time + 1, input.scenario.rules) : null;
      moves.set(agent.id, next ? { ...next } : { ...current });
    }
    return { assign, moves };
  }

  private tasksForMode(input: MapdStepInput, openTasks: readonly TaskSpec[]): readonly TaskSpec[] {
    if (this.mode !== "tpts") return openTasks;
    const byId = new Map<TaskId, TaskSpec>(openTasks.map((task) => [task.id, task]));
    for (const held of input.carrying.values()) {
      if (!held.pickedUp) byId.set(held.task.id, held.task);
    }
    return [...byId.values()].sort(
      (a, b) => a.releaseTime - b.releaseTime || a.id.localeCompare(b.id),
    );
  }

  private synchronize(input: MapdStepInput): void {
    const activeTaskIds = new Set<TaskId>();
    for (const held of input.carrying.values()) {
      activeTaskIds.add(held.task.id);
      this.token.assignments.set(held.task.id, this.findAgentForTask(input, held.task.id) ?? "");
    }
    const openIds = new Set(input.openTasks.map((task) => task.id));
    for (const [taskId] of this.token.assignments) {
      if (!activeTaskIds.has(taskId) && !openIds.has(taskId)) this.token.assignments.delete(taskId);
    }
    for (const [taskId, agentId] of this.token.assignments) {
      if (agentId === "") this.token.assignments.delete(taskId);
    }
  }

  private findAgentForTask(input: MapdStepInput, taskId: TaskId): AgentId | undefined {
    for (const [agentId, held] of input.carrying) if (held.task.id === taskId) return agentId;
    return undefined;
  }

  private normalizePaths(input: MapdStepInput): void {
    for (const agent of input.scenario.agents) {
      const current = input.positions.get(agent.id) ?? agent.start;
      const old = this.token.paths.get(agent.id);
      const future = old?.positions.filter((position) => position.time > input.time) ?? [];
      this.token.paths.set(agent.id, {
        agentId: agent.id,
        positions: [{ time: input.time, cell: { ...current } }, ...future],
      });
    }
  }

  private candidates(
    input: MapdStepInput,
    agentId: AgentId,
    tasks: readonly TaskSpec[],
    preferred?: TaskId,
  ): Candidate[] {
    const list = tasks
      .filter(
        (task) =>
          (this.mode === "tpts" || !this.token.assignments.has(task.id)) &&
          this.taskEligible(task, agentId),
      )
      .map((task) => ({ task, distance: this.distanceTo(input, agentId, task.pickup) }))
      .filter((candidate) => Number.isFinite(candidate.distance))
      .sort((a, b) => a.distance - b.distance || a.task.id.localeCompare(b.task.id));
    if (preferred === undefined) return list;
    const index = list.findIndex((candidate) => candidate.task.id === preferred);
    if (index <= 0) return list;
    const [first] = list.splice(index, 1);
    if (first) list.unshift(first);
    return list;
  }

  private taskEligible(task: TaskSpec, ownAgentId: AgentId): boolean {
    const assignedOwner = this.token.assignments.get(task.id);
    for (const [agentId, path] of this.token.paths) {
      if (agentId === ownAgentId) continue;
      if (this.mode === "tpts" && assignedOwner === agentId) continue;
      const last = path.positions[path.positions.length - 1];
      if (!last) continue;
      if (cellEquals(last.cell, task.pickup) || cellEquals(last.cell, task.delivery)) return false;
    }
    return true;
  }

  private planTask(input: MapdStepInput, agentId: AgentId, task: TaskSpec): boolean {
    const tokenWithoutSelf = new Map(this.token.paths);
    tokenWithoutSelf.delete(agentId);
    const pickupLatestTime = this.latestPickupTime(tokenWithoutSelf, task.pickup, input);
    const output = mlaStar({
      scenario: input.scenario,
      agentId,
      start:
        input.positions.get(agentId) ?? input.scenario.agents.find((a) => a.id === agentId)!.start,
      startTime: input.time,
      pickup: task.pickup,
      delivery: task.delivery,
      token: tokenWithoutSelf,
      maxTime:
        input.time +
        Math.min(
          this.options.maxHorizon,
          input.scenario.map.width * input.scenario.map.height * 2 + 64,
        ),
      maxExpansions: Math.max(1, this.options.maxExpansions - this.expanded),
      pickupLatestTime,
      shouldStop: this.stopBudget,
      emit: input.emit,
    });
    this.expanded += output.expanded;
    if (!output.path) return false;
    this.token.paths.set(agentId, output.path);
    input.emit({ type: "update-token", agentId, time: input.time });
    return true;
  }

  private planEndpoint(input: MapdStepInput, agentId: AgentId, endpoint: Cell): boolean {
    const tokenWithoutSelf = new Map(this.token.paths);
    tokenWithoutSelf.delete(agentId);
    const output = mlaStar({
      scenario: input.scenario,
      agentId,
      start: input.positions.get(agentId)!,
      startTime: input.time,
      pickup: endpoint,
      delivery: endpoint,
      token: tokenWithoutSelf,
      maxTime:
        input.time +
        Math.min(
          this.options.maxHorizon,
          input.scenario.map.width * input.scenario.map.height * 2 + 64,
        ),
      maxExpansions: Math.max(1, this.options.maxExpansions - this.expanded),
      shouldStop: this.stopBudget,
      emit: input.emit,
    });
    this.expanded += output.expanded;
    if (!output.path) return false;
    this.token.paths.set(agentId, output.path);
    input.emit({ type: "update-token", agentId, time: input.time });
    return true;
  }

  private latestPickupTime(
    token: ReadonlyMap<AgentId, TimedPath>,
    pickup: Cell,
    input: MapdStepInput,
  ): number | undefined {
    const times: number[] = [];
    for (const path of token.values()) {
      const last = path.positions[path.positions.length - 1];
      if (last && cellEquals(last.cell, pickup) && last.time >= input.time) times.push(last.time);
    }
    return times.length ? Math.min(...times) : undefined;
  }

  private needsPath2(input: MapdStepInput, agentId: AgentId): boolean {
    const current = input.positions.get(agentId);
    const taskSet = new Map<TaskId, TaskSpec>(input.openTasks.map((task) => [task.id, task]));
    // Path2 の task set は、まだ実行を終えていない task 全体。別 agent が
    // pickup 済みでも delivery endpoint を塞ぐなら、free agent はそこを避ける。
    for (const held of input.carrying.values()) taskSet.set(held.task.id, held.task);
    return (
      current !== undefined &&
      [...taskSet.values()].some((task) => cellEquals(task.delivery, current))
    );
  }

  private closestFreeEndpoint(input: MapdStepInput, agentId: AgentId): Cell | undefined {
    const occupiedEnds = new Set<string>();
    for (const [otherId, path] of this.token.paths) {
      if (otherId === agentId) continue;
      const last = path.positions[path.positions.length - 1];
      if (last) occupiedEnds.add(cellKey(last.cell));
    }
    const taskCells = new Set(input.endpoints.task.map(cellKey));
    return input.endpoints.nonTask
      .filter((cell) => !occupiedEnds.has(cellKey(cell)) && !taskCells.has(cellKey(cell)))
      .map((cell) => ({ cell, distance: this.distanceTo(input, agentId, cell) }))
      .filter((candidate) => Number.isFinite(candidate.distance))
      .sort((a, b) => a.distance - b.distance || cellKey(a.cell).localeCompare(cellKey(b.cell)))[0]
      ?.cell;
  }

  private hungarianPreferences(
    input: MapdStepInput,
    agents: readonly { id: AgentId }[],
    tasks: readonly TaskSpec[],
  ): Map<AgentId, TaskId> {
    if (agents.length === 0 || tasks.length === 0) return new Map();
    const costs = agents.map((agent) =>
      tasks.map((task) => {
        if (!this.taskEligible(task, agent.id)) return Number.POSITIVE_INFINITY;
        return this.distanceTo(input, agent.id, task.pickup);
      }),
    );
    const solution = hungarianMethod(costs);
    const result = new Map<AgentId, TaskId>();
    if (!solution) return result;
    solution.assignment.forEach((column, row) => {
      const task = column === null ? undefined : tasks[column];
      const agent = agents[row];
      if (task && agent) result.set(agent.id, task.id);
    });
    return result;
  }

  private distanceTo(input: MapdStepInput, agentId: AgentId, goal: Cell): number {
    const from = input.positions.get(agentId);
    if (!from) return Number.POSITIVE_INFINITY;
    const key = `${goal.x},${goal.y}`;
    let field = this.distanceCache.get(key);
    if (!field) {
      field = trueDistanceFrom(input.scenario.map, goal);
      this.distanceCache.set(key, field);
    }
    return field[from.y * input.scenario.map.width + from.x] ?? Number.POSITIVE_INFINITY;
  }

  private stopBudget = (): boolean => {
    return (
      this.context.signal.aborted ||
      this.context.now() - this.startedAt > this.options.timeoutMs ||
      this.expanded >= this.options.maxExpansions
    );
  };
}

export function createTokenPassingStrategy(
  options: SolverOptions,
  context: SolverContext,
): MapdStrategy {
  return new TokenMapdStrategy("tp", options, context);
}

export function createTptsStrategy(options: SolverOptions, context: SolverContext): MapdStrategy {
  return new TokenMapdStrategy("tpts", options, context);
}

export function createCentralStrategy(
  options: SolverOptions,
  context: SolverContext,
): MapdStrategy {
  return new TokenMapdStrategy("central", options, context);
}

export function createHbhStrategy(options: SolverOptions, context: SolverContext): MapdStrategy {
  return new TokenMapdStrategy("hbh", options, context);
}
