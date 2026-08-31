import type {
  AgentSpec,
  Cell,
  Conflict,
  FailureReason,
  MapfSolver,
  Scenario,
  SolverContext,
  SolverEvent,
  SolverOptions,
  SolverOutcome,
  SolverResult,
  SolverWarning,
  TimedPath,
} from "@/lib/model/types.js";
import {
  cellEquals,
  cellIndex,
  cellKey,
  indexToCell,
  isWalkable,
  lookupDistance,
  movesWithWait,
  neighbors,
  trueDistanceFrom,
} from "@/lib/model/grid.js";
import { createTraceRecorder } from "../context.js";
import { checkLimits } from "../limits.js";
import { buildResult, checkAbort, defaultMaxTime } from "../shared.js";

interface MstarNode {
  readonly key: string;
  readonly positions: readonly number[];
  g: number;
  readonly h: number;
  depth: number;
  parent?: string;
  readonly collisionSet: Set<number>;
  readonly backSet: Set<string>;
  closed: boolean;
  readonly sequence: number;
}

interface CollisionInfo {
  readonly agents: Set<number>;
  readonly first: Conflict;
}

type StopState = "timeout" | "aborted" | "node-limit" | null;

export const mstarSolver: MapfSolver = {
  metadata: {
    id: "mstar",
    displayName: "M*（Subdimensional Expansion）",
    originalName: "M*",
    category: "icts-joint-mstar",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: ["allowDiagonal", "goalBehavior"],
    basedOnPaperIds: ["mstar-aij-2015"],
    implementationNote:
      "AIJ 2015 Algorithms 1–2 の basic M*、limited neighbors、collision set と backpropagation set を実装。edge collision は site の transition 上で直接検出。recursive / operator-decomposition / inflated M* は未対応。",
  },

  async solve(scenario, options, context): Promise<SolverResult> {
    return solveMstar(scenario, options, context);
  },
};

async function solveMstar(
  scenario: Scenario,
  options: SolverOptions,
  context: SolverContext,
): Promise<SolverResult> {
  const startedAt = context.now();
  const recorder = createTraceRecorder(options);
  const limits = checkLimits(scenario, options);
  const warnings: SolverWarning[] = [...limits.warnings];
  const emit = (event: SolverEvent): void => {
    recorder.record(event);
    context.emit(event);
  };
  let expanded = 0;
  let generated = 0;
  let conflictsDetected = 0;
  let sequence = 0;
  let horizonCutoff = false;
  let stopState: StopState = null;

  if (!limits.ok) return finish(limits.result!);
  const validation = validateScenario(scenario);
  if (validation) return finish(errorResult(validation.code, validation.message));
  const horizonResult = resolveHorizon(scenario, options);
  if ("error" in horizonResult) return finish(errorResult("invalid-scenario", horizonResult.error));
  const maxDepth = horizonResult.value;

  const agents = scenario.agents as readonly (AgentSpec & { readonly goal: Cell })[];
  const distances = agents.map((agent) => trueDistanceFrom(scenario.map, agent.goal));
  for (let index = 0; index < agents.length; index += 1) {
    if (!Number.isFinite(lookupDistance(scenario.map, distances[index]!, agents[index]!.start))) {
      return finish(failureResult("no-solution", "unreachable-goal"));
    }
  }

  const policies = agents.map((agent, agentIndex) => {
    const policy = new Int32Array(scenario.map.width * scenario.map.height);
    for (let index = 0; index < policy.length; index += 1) {
      const cell = indexToCell(scenario.map, index);
      if (!isWalkable(scenario.map, cell) || cellEquals(cell, agent.goal)) {
        policy[index] = index;
        continue;
      }
      const currentDistance = distances[agentIndex]![index] ?? Number.POSITIVE_INFINITY;
      const next = neighbors(scenario.map, cell, scenario.rules)
        .map((candidate) => cellIndex(scenario.map, candidate))
        .filter(
          (candidate) =>
            (distances[agentIndex]![candidate] ?? Number.POSITIVE_INFINITY) < currentDistance,
        )
        .sort((left, right) => left - right)[0];
      policy[index] = next ?? index;
    }
    return policy;
  });
  const rootPositions = agents.map((agent) => cellIndex(scenario.map, agent.start));
  const root = createNode(rootPositions, 0, 0);
  const nodes = new Map<string, MstarNode>([[root.key, root]]);
  const open = new Set<string>([root.key]);

  while (open.size > 0) {
    const abort = consumeExpansion();
    if (abort !== "ok") return finish(failureResult(abort, "limit-exceeded"));
    const selected = popBest(open, nodes);
    if (!selected) return finish(internalError("M* の OPEN が不整合になりました。"));
    const current: MstarNode = selected;
    current.closed = true;
    emit({ type: "configuration-expand", configId: current.key, depth: current.depth });
    emit({
      type: "expand-node",
      state: {
        configId: current.key,
        g: current.g,
        h: current.h,
        collisionSet: [...current.collisionSet].map((index) => agents[index]!.id),
      },
    });

    if (atGoal(current.positions)) {
      const paths = reconstruct(current, nodes);
      const base = buildResult(scenario, paths, context.now() - startedAt, expanded, "solved", {
        generatedNodes: generated,
        conflictsDetected,
        lowerBound: root.h,
      });
      if (base.conflicts.length > 0)
        return finish(internalError("M* の解に conflict が残りました。"));
      for (let time = 1; time < paths[0]!.positions.length; time += 1) {
        const positions: Record<string, Cell> = {};
        for (const path of paths) positions[path.agentId] = path.positions[time]!.cell;
        emit({ type: "move", time, positions });
      }
      return finish(base);
    }

    if (current.depth >= maxDepth) {
      horizonCutoff = true;
      continue;
    }

    const choices = current.positions.map((position, index) => {
      if (current.collisionSet.has(index)) {
        return movesWithWait(scenario.map, indexToCell(scenario.map, position), scenario.rules)
          .map((cell) => cellIndex(scenario.map, cell))
          .sort((left, right) => left - right);
      }
      return [policies[index]![position]!];
    });
    const candidate = new Array<number>(agents.length);
    enumerate(0);
    if (stopState) return finish(failureResult(stopState, "limit-exceeded"));

    function enumerate(offset: number): void {
      if (stopState) return;
      if (offset === agents.length) {
        generated += 1;
        if (candidate.every((position, index) => position === current.positions[index])) return;
        const collision = transitionCollision(current.positions, candidate, current.depth + 1);
        if (collision) {
          conflictsDetected += 1;
          emit({ type: "detect-conflict", conflict: collision.first });
          backpropagate(current.key, collision.agents, current.key);
          return;
        }

        const successorKey = configurationKey(candidate);
        let successor = nodes.get(successorKey);
        if (!successor) {
          successor = createNode(candidate.slice(), Number.POSITIVE_INFINITY, current.depth + 1);
          nodes.set(successorKey, successor);
        }
        successor.backSet.add(current.key);
        if (successor.collisionSet.size > 0) {
          backpropagate(current.key, successor.collisionSet, successor.key);
        }
        const tentative = current.g + transitionCost(current.positions, candidate);
        if (tentative < successor.g) {
          successor.g = tentative;
          successor.depth = current.depth + 1;
          successor.parent = current.key;
          successor.closed = false;
          open.add(successor.key);
          emit({
            type: "configuration-generate",
            configId: successor.key,
            positions: Object.fromEntries(
              agents.map((agent, index) => [
                agent.id,
                indexToCell(scenario.map, candidate[index]!),
              ]),
            ),
          });
        }
        return;
      }

      for (const position of choices[offset]!) {
        candidate[offset] = position;
        enumerate(offset + 1);
        if (stopState) return;
      }
    }
  }

  if (horizonCutoff) {
    warnings.push({
      code: "input-too-large",
      message: `M* は時刻上限 ${maxDepth} で探索を打ち切りました。解の非存在を証明した結果ではありません。`,
    });
    return finish(failureResult("node-limit", "limit-exceeded"));
  }
  return finish(failureResult("no-solution", "search-exhausted"));

  function createNode(positions: readonly number[], g: number, depth: number): MstarNode {
    return {
      key: configurationKey(positions),
      positions,
      g,
      h: positions.reduce(
        (sum, position, index) => sum + (distances[index]![position] ?? Number.POSITIVE_INFINITY),
        0,
      ),
      depth,
      collisionSet: new Set<number>(),
      backSet: new Set<string>(),
      closed: false,
      sequence: sequence++,
    };
  }

  function backpropagate(
    startKey: string,
    additions: ReadonlySet<number>,
    sourceKey: string,
  ): void {
    const stack: { key: string; from: string }[] = [{ key: startKey, from: sourceKey }];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const item = stack.pop()!;
      if (visited.has(item.key)) continue;
      visited.add(item.key);
      const node = nodes.get(item.key);
      if (!node) continue;
      let changed = false;
      for (const agent of additions) {
        if (!node.collisionSet.has(agent)) {
          node.collisionSet.add(agent);
          changed = true;
        }
      }
      if (!changed) continue;
      emit({
        type: "update-collision-set",
        configId: node.key,
        agentIds: [...node.collisionSet].sort((a, b) => a - b).map((index) => agents[index]!.id),
      });
      if (node.key !== item.from) {
        emit({
          type: "backpropagate-collision",
          fromConfigId: item.from,
          toConfigId: node.key,
          agentIds: [...additions].sort((a, b) => a - b).map((index) => agents[index]!.id),
        });
      }
      if (Number.isFinite(node.g)) {
        node.closed = false;
        open.add(node.key);
      }
      for (const predecessor of node.backSet) stack.push({ key: predecessor, from: node.key });
    }
  }

  function transitionCollision(
    from: readonly number[],
    to: readonly number[],
    time: number,
  ): CollisionInfo | null {
    const involved = new Set<number>();
    let first: Conflict | undefined;
    for (let left = 0; left < to.length; left += 1) {
      for (let right = left + 1; right < to.length; right += 1) {
        if (to[left] === to[right]) {
          involved.add(left);
          involved.add(right);
          first ??= {
            kind: "vertex",
            agentA: agents[left]!.id,
            agentB: agents[right]!.id,
            cell: indexToCell(scenario.map, to[left]!),
            time,
          };
        } else if (
          scenario.rules.forbidEdgeSwap &&
          from[left] === to[right] &&
          from[right] === to[left] &&
          from[left] !== to[left]
        ) {
          involved.add(left);
          involved.add(right);
          first ??= {
            kind: "edge-swap",
            agentA: agents[left]!.id,
            agentB: agents[right]!.id,
            from: indexToCell(scenario.map, from[left]!),
            to: indexToCell(scenario.map, to[left]!),
            time,
          };
        } else if (scenario.rules.forbidFollowing) {
          /*
            ★ following は非対称なので両方向を見る。
              「A が t に居るセルを、B が t-1 に居て t に空けた」が条件。
              left/right のどちらが A 側かで 2 通りある。
          */
          const follows = (a: number, b: number) => to[a] === from[b] && to[b] !== from[b];
          const follower = follows(left, right) ? left : follows(right, left) ? right : null;
          if (follower !== null) {
            const vacated = follower === left ? right : left;
            involved.add(left);
            involved.add(right);
            first ??= {
              kind: "following",
              agentA: agents[follower]!.id,
              agentB: agents[vacated]!.id,
              cell: indexToCell(scenario.map, to[follower]!),
              time,
            };
          }
        }
      }
    }
    return first ? { agents: involved, first } : null;
  }

  function transitionCost(from: readonly number[], to: readonly number[]): number {
    let cost = 0;
    for (let index = 0; index < agents.length; index += 1) {
      const goal = cellIndex(scenario.map, agents[index]!.goal);
      if (from[index] !== goal || to[index] !== goal) cost += 1;
    }
    return cost;
  }

  function atGoal(positions: readonly number[]): boolean {
    return positions.every(
      (position, index) => position === cellIndex(scenario.map, agents[index]!.goal),
    );
  }

  function reconstruct(goal: MstarNode, allNodes: ReadonlyMap<string, MstarNode>): TimedPath[] {
    const configurations: (readonly number[])[] = [];
    let current: MstarNode | undefined = goal;
    while (current) {
      configurations.push(current.positions);
      current = current.parent ? allNodes.get(current.parent) : undefined;
    }
    configurations.reverse();
    return agents.map((agent, index) => ({
      agentId: agent.id,
      positions: configurations.map((configuration, time) => ({
        cell: indexToCell(scenario.map, configuration[index]!),
        time,
      })),
    }));
  }

  function consumeExpansion(): "ok" | Exclude<StopState, null> {
    const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
    if (abort !== "ok") {
      stopState = abort;
      return abort;
    }
    if (expanded >= options.maxExpansions) {
      stopState = "node-limit";
      return stopState;
    }
    expanded += 1;
    return "ok";
  }

  function failureResult(outcome: SolverOutcome, reason: FailureReason): SolverResult {
    return {
      outcome,
      paths: [],
      metrics: {
        sumOfCosts: 0,
        makespan: 0,
        runtimeMs: context.now() - startedAt,
        expandedNodes: expanded,
        generatedNodes: generated,
        conflictsDetected,
      },
      conflicts: [],
      failureReason: reason,
    };
  }

  function errorResult(
    code: "invalid-scenario" | "unsupported-rules",
    message: string,
  ): SolverResult {
    return {
      ...failureResult("error", code === "unsupported-rules" ? "unsupported-rules" : "internal"),
      error: { code, message },
    };
  }

  function internalError(message: string): SolverResult {
    return { ...failureResult("error", "internal"), error: { code: "internal", message } };
  }

  function finish(base: SolverResult): SolverResult {
    const beforeTrace = mergeWarnings(base.warnings, warnings);
    const eventResult = { ...base, ...(beforeTrace.length > 0 ? { warnings: beforeTrace } : {}) };
    emit({ type: "finish", result: eventResult });
    const allWarnings = mergeWarnings(beforeTrace, recorder.warnings);
    return {
      ...eventResult,
      ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
      ...(options.traceLevel === "off" ? {} : { trace: recorder.events }),
    };
  }
}

function popBest(open: Set<string>, nodes: ReadonlyMap<string, MstarNode>): MstarNode | undefined {
  let best: MstarNode | undefined;
  for (const key of open) {
    const node = nodes.get(key);
    if (!node) continue;
    if (
      !best ||
      node.g + node.h < best.g + best.h ||
      (node.g + node.h === best.g + best.h &&
        (node.h < best.h ||
          (node.h === best.h &&
            (node.sequence < best.sequence ||
              (node.sequence === best.sequence && node.key < best.key)))))
    ) {
      best = node;
    }
  }
  if (best) open.delete(best.key);
  return best;
}

function configurationKey(positions: readonly number[]): string {
  return positions.join(",");
}

function validateScenario(
  scenario: Scenario,
): { readonly code: "invalid-scenario" | "unsupported-rules"; readonly message: string } | null {
  if (scenario.kind !== "one-shot-mapf") {
    return { code: "unsupported-rules", message: "M* は one-shot MAPF のみに対応します。" };
  }
  if (scenario.rules.allowDiagonal) {
    return {
      code: "unsupported-rules",
      message: "M* は 4 近傍かつ following conflict を許すモデルだけに対応します。",
    };
  }
  if (scenario.rules.goalBehavior !== "stay") {
    return { code: "unsupported-rules", message: "M* は stay-at-goal モデルだけに対応します。" };
  }
  if (scenario.agents.length === 0)
    return { code: "invalid-scenario", message: "エージェントが 1 体もありません。" };
  const ids = new Set<string>();
  const starts = new Set<string>();
  const goals = new Set<string>();
  for (const agent of scenario.agents) {
    if (ids.has(agent.id))
      return { code: "invalid-scenario", message: `agent ID ${agent.id} が重複しています。` };
    ids.add(agent.id);
    if (!agent.goal)
      return { code: "invalid-scenario", message: `${agent.id} に goal がありません。` };
    if (!isWalkable(scenario.map, agent.start) || !isWalkable(scenario.map, agent.goal)) {
      return {
        code: "invalid-scenario",
        message: `${agent.id} の start または goal が通行不能です。`,
      };
    }
    const start = cellKey(agent.start);
    const goal = cellKey(agent.goal);
    if (starts.has(start))
      return { code: "invalid-scenario", message: "複数 agent の start が重複しています。" };
    if (goals.has(goal))
      return { code: "invalid-scenario", message: "複数 agent の goal が重複しています。" };
    starts.add(start);
    goals.add(goal);
  }
  return null;
}

function resolveHorizon(
  scenario: Scenario,
  options: SolverOptions,
): { readonly value: number } | { readonly error: string } {
  const raw = options.extra?.maxTimesteps ?? options.horizon;
  const fallback = Math.min(options.maxHorizon, defaultMaxTime(scenario));
  if (raw === undefined) return { value: fallback };
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > options.maxHorizon) {
    return { error: `maxTimesteps は 1..${options.maxHorizon} の整数で指定してください。` };
  }
  return { value: raw };
}

function mergeWarnings(
  ...groups: readonly (readonly SolverWarning[] | undefined)[]
): SolverWarning[] {
  const result: SolverWarning[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const warning of group ?? []) {
      const key = `${warning.code}\u0000${warning.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(warning);
      }
    }
  }
  return result;
}
