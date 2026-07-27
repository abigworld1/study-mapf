import type {
  AgentSpec,
  Cell,
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
  cellIndex,
  cellKey,
  indexToCell,
  isWalkable,
  lookupDistance,
  movesWithWait,
  trueDistanceFrom,
} from "@/lib/model/grid.js";
import { MinHeap } from "../cbs/heap.js";
import { createTraceRecorder } from "../context.js";
import { checkLimits } from "../limits.js";
import { buildResult, checkAbort } from "../shared.js";

type Variant = "lacam" | "lacam-star";
type StopState = "timeout" | "aborted" | "node-limit" | null;

interface LowLevelNode {
  readonly id: number;
  readonly depth: number;
  readonly assignments: readonly (number | undefined)[];
}

interface HighLevelNode {
  readonly id: string;
  readonly positions: readonly number[];
  readonly key: string;
  parent: HighLevelNode | undefined;
  depth: number;
  readonly priorities: readonly number[];
  readonly order: readonly number[];
  readonly tree: LowLevelNode[];
  treeHead: number;
  readonly neighbors: HighLevelNode[];
  readonly neighborKeys: Set<string>;
  g: number;
  readonly h: number;
}

interface ValidationError {
  readonly code: "invalid-scenario" | "unsupported-rules";
  readonly message: string;
}

export const lacamSolver: MapfSolver = {
  metadata: {
    id: "lacam",
    displayName: "LaCAM（遅延制約追加探索）",
    originalName: "Lazy Constraints Addition search for MAPF",
    category: "pibt-lacam",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: ["allowDiagonal", "forbidFollowing", "goalBehavior"],
    basedOnPaperIds: ["lacam-aaai-2023"],
    implementationNote:
      "AAAI 2023 Algorithm 1 の configuration DFS、constraint-tree BFS、lazy successor generation を独立実装。generator は同論文 §3.3 の PIBT 型 1-step assignment。既知 node 再挿入などの engineering は LaCAM* と区別するため含めない。",
  },

  async solve(scenario, options, context): Promise<SolverResult> {
    return solveLacam("lacam", scenario, options, context);
  },
};

export const lacamStarSolver: MapfSolver = {
  metadata: {
    id: "lacam-star",
    displayName: "LaCAM*（最終的最適探索）",
    originalName: "LaCAM star",
    category: "pibt-lacam",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "reference-validated",
    unsupportedRules: ["allowDiagonal", "forbidFollowing", "goalBehavior"],
    basedOnPaperIds: ["lacam-star-ijcai-2023", "lacam-aaai-2023"],
    validatedAgainst: [
      "Kei18/pylacam 864a158f: 3x2 empty swap fixture で success、sum-of-loss=6、makespan=4、path validity を比較。browser implementation も同じ値と validity を得た。",
    ],
    implementationNote:
      "IJCAI 2023 Algorithm 3 の goal 保持、既知 configuration への有向辺追加、Dijkstra rewiring、admissible f 枝刈りを独立実装。最適性は OPEN 完了時の sum-of-loss に対する eventual guarantee であり、有限 cutoff 時やサイト表示 SOC に対する保証ではない。PIBT swap と random restart は未対応。",
  },

  async solve(scenario, options, context): Promise<SolverResult> {
    return solveLacam("lacam-star", scenario, options, context);
  },
};

async function solveLacam(
  variant: Variant,
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
  let sequence = 0;
  let lowLevelSequence = 0;
  let stopState: StopState = null;
  let horizonCutoff = false;
  let generatorPolls = 0;

  if (!limits.ok) return finish(limits.result!);
  const validation = validateScenario(scenario);
  if (validation) return finish(errorResult(validation.code, validation.message));
  const pathLengthResult = resolveMaxPathLength(options);
  if ("error" in pathLengthResult) {
    return finish(errorResult("invalid-scenario", pathLengthResult.error));
  }
  const maxPathLength = pathLengthResult.value;
  if (options.suboptimalityFactor !== undefined) {
    warnings.push({
      code: "option-ignored",
      message: `${variant === "lacam" ? "LaCAM" : "LaCAM*"} は suboptimalityFactor を使用しません。`,
    });
  }
  if (variant === "lacam-star") {
    warnings.push({
      code: "simplified-behavior",
      message:
        "LaCAM* の内部目的は原論文の sum-of-loss です。metrics.sumOfCosts はサイト共通定義で path から再計算するため、goal を離れる解では内部目的値と異なることがあります。",
    });
  }

  const agents = scenario.agents as readonly (AgentSpec & { readonly goal: Cell })[];
  const area = scenario.map.width * scenario.map.height;
  const goals = agents.map((agent) => cellIndex(scenario.map, agent.goal));
  const distances = agents.map((agent) => trueDistanceFrom(scenario.map, agent.goal));
  for (let index = 0; index < agents.length; index += 1) {
    if (!Number.isFinite(lookupDistance(scenario.map, distances[index]!, agents[index]!.start))) {
      return finish(failureResult("no-solution", "unreachable-goal"));
    }
  }

  // Candidate の最終同点順を一度だけ seed から作る。同じ探索中は固定する。
  const tieRanks = agents.map(() => Array.from({ length: area }, () => context.random()));
  const rootPositions = agents.map((agent) => cellIndex(scenario.map, agent.start));
  const maxInitialDistance = Math.max(
    0,
    ...rootPositions.map((position, index) => distances[index]![position] ?? 0),
  );
  const initialFractions = agents.map((_, index) => {
    const distance = distances[index]![rootPositions[index]!] ?? 0;
    const seededTie = context.random() / Math.max(2, agents.length + 1);
    return (distance + seededTie) / Math.max(1, maxInitialDistance + 1);
  });
  const root = createHighLevelNode(rootPositions, undefined, 0);
  const explored = new Map<string, HighLevelNode>([[root.key, root]]);
  const open: HighLevelNode[] = [root];
  let goalNode: HighLevelNode | undefined;

  while (open.length > 0) {
    const stop = consumeExpansion(false);
    if (stop !== "ok") return finish(stoppedResult(stop));

    const node = open[open.length - 1]!;
    if (isGoalConfiguration(node.positions)) {
      if (variant === "lacam") return finish(solutionResult(node, "solved"));
      if (goalNode === undefined) {
        goalNode = node;
        emit({ type: "update-incumbent", cost: node.g, iteration: expanded });
      }
    }

    // Algorithm 3 line 7。goal node 自身もここで OPEN から外れる。
    if (variant === "lacam-star" && goalNode !== undefined && goalNode.g <= node.g + node.h) {
      open.pop();
      continue;
    }
    if (node.treeHead >= node.tree.length) {
      open.pop();
      continue;
    }

    const expansionStop = consumeExpansion(true);
    if (expansionStop !== "ok") return finish(stoppedResult(expansionStop));
    const constraint = node.tree[node.treeHead++]!;
    emit({ type: "configuration-expand", configId: node.id, depth: node.depth });
    emit({
      type: "expand-node",
      state: {
        configId: node.id,
        configurationDepth: node.depth,
        constraintDepth: constraint.depth,
        g: node.g,
        h: node.h,
      },
    });

    if (constraint.depth < agents.length) {
      const agentIndex = node.order[constraint.depth]!;
      const candidates = actionIndices(node.positions[agentIndex]!, agentIndex).sort(
        (left, right) =>
          tieRanks[agentIndex]![left]! - tieRanks[agentIndex]![right]! || left - right,
      );
      for (const where of candidates) {
        const assignments = constraint.assignments.slice();
        assignments[agentIndex] = where;
        const child: LowLevelNode = {
          id: ++lowLevelSequence,
          depth: constraint.depth + 1,
          assignments,
        };
        node.tree.push(child);
        emit({ type: "create-low-level-node", configId: node.id, agentId: agents[agentIndex]!.id });
        emit({
          type: "add-lazy-constraint",
          configId: node.id,
          agentId: agents[agentIndex]!.id,
          cell: indexToCell(scenario.map, where),
        });
      }
    }

    const nextPositions = generateConfiguration(node, constraint);
    if (stopState) return finish(stoppedResult(stopState));
    if (!nextPositions) continue;
    generated += 1;
    const nextKey = configurationKey(nextPositions);
    emit({
      type: "configuration-generate",
      configId: nextKey,
      positions: positionsRecord(nextPositions),
    });

    const known = explored.get(nextKey);
    if (known) {
      if (variant === "lacam-star" && addNeighbor(node, known)) relaxFrom(node);
      if (stopState) return finish(stoppedResult(stopState));
      continue;
    }

    if (node.depth >= maxPathLength) {
      horizonCutoff = true;
      continue;
    }
    const edgeCost = transitionCost(node.positions, nextPositions);
    const next = createHighLevelNode(nextPositions, node, node.g + edgeCost);
    explored.set(next.key, next);
    if (variant === "lacam-star") addNeighbor(node, next);
    open.push(next);
    if (expanded % 100 === 0) {
      emit({
        type: "progress",
        ratio: Math.min(0.99, expanded / Math.max(1, options.maxExpansions)),
        label: `${variant === "lacam" ? "LaCAM" : "LaCAM*"}: ${explored.size} configurations`,
      });
    }
  }

  if (horizonCutoff) {
    warnings.push({
      code: "simplified-behavior",
      message: `最大 path length ${maxPathLength} で後継を打ち切りました。これは解不存在の証明ではありません。`,
    });
    if (goalNode) {
      const incumbent = solutionResult(goalNode, "node-limit");
      return finish({ ...incumbent, failureReason: "limit-exceeded" });
    }
    return finish(failureResult("node-limit", "limit-exceeded"));
  }
  if (goalNode) return finish(solutionResult(goalNode, "solved"));
  return finish(failureResult("no-solution", "search-exhausted"));

  function createHighLevelNode(
    positions: readonly number[],
    parent: HighLevelNode | undefined,
    g: number,
  ): HighLevelNode {
    const key = configurationKey(positions);
    const priorities = positions.map((position, index) => {
      if (!parent) return initialFractions[index]!;
      const previous = parent.priorities[index]!;
      return position === goals[index] ? previous - Math.floor(previous) : previous + 1;
    });
    const order = agents
      .map((_, index) => index)
      .sort((left, right) => priorities[right]! - priorities[left]! || left - right);
    const h = positions.reduce(
      (sum, position, index) => sum + (distances[index]![position] ?? Number.POSITIVE_INFINITY),
      0,
    );
    return {
      id: `cfg-${++sequence}:${key}`,
      positions: positions.slice(),
      key,
      parent,
      depth: parent ? parent.depth + 1 : 0,
      priorities,
      order,
      tree: [{ id: ++lowLevelSequence, depth: 0, assignments: new Array(agents.length) }],
      treeHead: 0,
      neighbors: [],
      neighborKeys: new Set<string>(),
      g,
      h,
    };
  }

  function generateConfiguration(
    node: HighLevelNode,
    constraint: LowLevelNode,
  ): readonly number[] | undefined {
    const current = node.positions;
    const ownerNow = new Int32Array(area).fill(-1);
    const ownerNext = new Int32Array(area).fill(-1);
    const next: (number | undefined)[] = new Array(agents.length);
    for (let index = 0; index < current.length; index += 1) ownerNow[current[index]!] = index;

    for (let index = 0; index < agents.length; index += 1) {
      const target = constraint.assignments[index];
      if (target === undefined) continue;
      if (!actionIndices(current[index]!, index).includes(target)) return undefined;
      if (ownerNext[target] !== -1) return undefined;
      next[index] = target;
      ownerNext[target] = index;
    }
    for (let index = 0; index < agents.length; index += 1) {
      const target = next[index];
      if (target === undefined || !scenario.rules.forbidEdgeSwap) continue;
      const occupant = ownerNow[target]!;
      if (occupant >= 0 && occupant !== index && next[occupant] === current[index])
        return undefined;
    }

    for (const agentIndex of node.order) {
      if (next[agentIndex] !== undefined) continue;
      if (!assign(agentIndex)) return undefined;
      if (stopState) return undefined;
    }
    if (next.some((position) => position === undefined)) return undefined;
    return next as number[];

    function assign(agentIndex: number): boolean {
      if (pollGeneratorStop()) return false;
      const candidates = actionIndices(current[agentIndex]!, agentIndex).sort((left, right) => {
        const distanceDifference = distances[agentIndex]![left]! - distances[agentIndex]![right]!;
        return (
          distanceDifference ||
          tieRanks[agentIndex]![left]! - tieRanks[agentIndex]![right]! ||
          left - right
        );
      });
      emit({
        type: "candidate-evaluation",
        agentId: agents[agentIndex]!.id,
        candidates: candidates.map((position) => ({
          cell: indexToCell(scenario.map, position),
          score: distances[agentIndex]![position]!,
        })),
      });

      for (const target of candidates) {
        if (ownerNext[target] !== -1) continue;
        const occupant = ownerNow[target]!;
        if (
          scenario.rules.forbidEdgeSwap &&
          occupant >= 0 &&
          occupant !== agentIndex &&
          next[occupant] === current[agentIndex]
        ) {
          continue;
        }

        const savedNext = next.slice();
        const savedOwner = ownerNext.slice();
        next[agentIndex] = target;
        ownerNext[target] = agentIndex;
        if (occupant >= 0 && occupant !== agentIndex && next[occupant] === undefined) {
          emit({
            type: "inherit-priority",
            from: agents[agentIndex]!.id,
            to: agents[occupant]!.id,
          });
          if (!assign(occupant)) {
            restore(savedNext, savedOwner);
            emit({ type: "backtrack", agentId: agents[agentIndex]!.id });
            if (stopState) return false;
            continue;
          }
        }
        return true;
      }
      emit({ type: "backtrack", agentId: agents[agentIndex]!.id });
      return false;
    }

    function restore(savedNext: readonly (number | undefined)[], savedOwner: Int32Array): void {
      for (let index = 0; index < next.length; index += 1) next[index] = savedNext[index];
      ownerNext.set(savedOwner);
    }
  }

  function actionIndices(position: number, agentIndex: number): number[] {
    return movesWithWait(scenario.map, indexToCell(scenario.map, position), scenario.rules)
      .map((cell) => cellIndex(scenario.map, cell))
      .filter((candidate) => Number.isFinite(distances[agentIndex]![candidate]));
  }

  function addNeighbor(from: HighLevelNode, to: HighLevelNode): boolean {
    if (from.neighborKeys.has(to.key)) return false;
    from.neighborKeys.add(to.key);
    from.neighbors.push(to);
    return true;
  }

  function relaxFrom(source: HighLevelNode): void {
    const queue = new MinHeap<{ readonly node: HighLevelNode; readonly cost: number }>(
      (left, right) =>
        left.cost !== right.cost
          ? left.cost - right.cost
          : left.node.id < right.node.id
            ? -1
            : left.node.id > right.node.id
              ? 1
              : 0,
    );
    queue.push({ node: source, cost: source.g });
    while (queue.size > 0) {
      if (pollGeneratorStop()) return;
      const entry = queue.pop()!;
      if (entry.cost !== entry.node.g) continue;
      for (const neighbor of entry.node.neighbors) {
        const candidate = entry.node.g + transitionCost(entry.node.positions, neighbor.positions);
        if (candidate >= neighbor.g) continue;
        const previous = neighbor.g;
        neighbor.g = candidate;
        neighbor.parent = entry.node;
        neighbor.depth = entry.node.depth + 1;
        emit({
          type: "rewire-configuration",
          configId: neighbor.id,
          parentConfigId: entry.node.id,
          previousCost: previous,
          newCost: candidate,
        });
        queue.push({ node: neighbor, cost: candidate });
        if (goalNode === neighbor) {
          emit({ type: "update-incumbent", cost: candidate, iteration: expanded });
        }
        if (goalNode && neighbor.g + neighbor.h < goalNode.g) open.push(neighbor);
      }
    }
  }

  function transitionCost(from: readonly number[], to: readonly number[]): number {
    let cost = 0;
    for (let index = 0; index < agents.length; index += 1) {
      if (from[index] !== goals[index] || to[index] !== goals[index]) cost += 1;
    }
    return cost;
  }

  function isGoalConfiguration(positions: readonly number[]): boolean {
    return positions.every((position, index) => position === goals[index]);
  }

  function positionsRecord(positions: readonly number[]): Record<string, Cell> {
    const record: Record<string, Cell> = {};
    for (let index = 0; index < agents.length; index += 1) {
      record[agents[index]!.id] = indexToCell(scenario.map, positions[index]!);
    }
    return record;
  }

  function reconstruct(goal: HighLevelNode): TimedPath[] | undefined {
    const configurations: (readonly number[])[] = [];
    const seen = new Set<HighLevelNode>();
    let cursor: HighLevelNode | undefined = goal;
    while (cursor) {
      if (seen.has(cursor)) return undefined;
      seen.add(cursor);
      configurations.push(cursor.positions);
      cursor = cursor.parent;
    }
    configurations.reverse();
    return agents.map((agent, index) => ({
      agentId: agent.id,
      positions: configurations.map((configuration, time) => ({
        time,
        cell: indexToCell(scenario.map, configuration[index]!),
      })),
    }));
  }

  function solutionResult(goal: HighLevelNode, outcome: SolverOutcome): SolverResult {
    const paths = reconstruct(goal);
    if (!paths) return internalError("LaCAM* の parent relation に cycle があります。");
    const result = buildResult(scenario, paths, context.now() - startedAt, expanded, outcome, {
      generatedNodes: generated,
    });
    if (result.conflicts.length > 0) {
      return internalError("LaCAM の configuration sequence に conflict が残りました。");
    }
    for (let time = 1; time < (paths[0]?.positions.length ?? 0); time += 1) {
      const positions: Record<string, Cell> = {};
      for (const path of paths) positions[path.agentId] = path.positions[time]!.cell;
      emit({ type: "move", time, positions });
    }
    return result;
  }

  function stoppedResult(outcome: Exclude<StopState, null>): SolverResult {
    if (goalNode) {
      const result = solutionResult(goalNode, outcome);
      return { ...result, failureReason: "limit-exceeded" };
    }
    return failureResult(outcome, "limit-exceeded");
  }

  function consumeExpansion(count: boolean): "ok" | Exclude<StopState, null> {
    const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
    if (abort !== "ok") {
      stopState = abort;
      return abort;
    }
    if (count && expanded >= options.maxExpansions) {
      stopState = "node-limit";
      return stopState;
    }
    if (count) expanded += 1;
    return "ok";
  }

  function pollGeneratorStop(): boolean {
    generatorPolls += 1;
    if (generatorPolls % 64 !== 0) return false;
    const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
    if (abort === "ok") return false;
    stopState = abort;
    return true;
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
    return {
      ...failureResult("error", "internal"),
      error: { code: "internal", message },
    };
  }

  function finish(result: SolverResult): SolverResult {
    const beforeTrace = mergeWarnings(result.warnings, warnings);
    const eventResult: SolverResult = {
      ...result,
      ...(beforeTrace.length > 0 ? { warnings: beforeTrace } : {}),
    };
    emit({ type: "finish", result: eventResult });
    const allWarnings = mergeWarnings(beforeTrace, recorder.warnings);
    return {
      ...eventResult,
      ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
      ...(options.traceLevel === "off" ? {} : { trace: recorder.events }),
    };
  }
}

function configurationKey(positions: readonly number[]): string {
  return positions.join(",");
}

function validateScenario(scenario: Scenario): ValidationError | null {
  if (scenario.kind !== "one-shot-mapf") {
    return { code: "unsupported-rules", message: "LaCAM 系は one-shot MAPF のみに対応します。" };
  }
  if (scenario.rules.allowDiagonal || scenario.rules.forbidFollowing) {
    return {
      code: "unsupported-rules",
      message: "LaCAM 系は 4 近傍かつ following conflict を許すモデルだけに対応します。",
    };
  }
  if (scenario.rules.goalBehavior !== "stay") {
    return {
      code: "unsupported-rules",
      message: "LaCAM 系は stay-at-goal モデルだけに対応します。",
    };
  }
  if (scenario.agents.length === 0) {
    return { code: "invalid-scenario", message: "エージェントが 1 体もありません。" };
  }
  const ids = new Set<string>();
  const starts = new Set<string>();
  const goals = new Set<string>();
  for (const agent of scenario.agents) {
    if (ids.has(agent.id)) {
      return { code: "invalid-scenario", message: `agent ID ${agent.id} が重複しています。` };
    }
    ids.add(agent.id);
    if (!agent.goal) {
      return { code: "invalid-scenario", message: `${agent.id} に goal がありません。` };
    }
    if (!isWalkable(scenario.map, agent.start) || !isWalkable(scenario.map, agent.goal)) {
      return {
        code: "invalid-scenario",
        message: `${agent.id} の start または goal が通行不能です。`,
      };
    }
    const start = cellKey(agent.start);
    const goal = cellKey(agent.goal);
    if (starts.has(start)) {
      return { code: "invalid-scenario", message: "複数 agent の start が重複しています。" };
    }
    if (goals.has(goal)) {
      return { code: "invalid-scenario", message: "複数 agent の goal が重複しています。" };
    }
    starts.add(start);
    goals.add(goal);
  }
  return null;
}

function resolveMaxPathLength(
  options: SolverOptions,
): { readonly value: number } | { readonly error: string } {
  const raw = options.extra?.maxPathLength ?? options.horizon;
  if (raw === undefined) return { value: options.maxHorizon };
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > options.maxHorizon) {
    return { error: `maxPathLength は 1..${options.maxHorizon} の整数で指定してください。` };
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
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(warning);
    }
  }
  return result;
}
