import type {
  AgentSpec,
  Conflict,
  Constraint,
  FailureReason,
  Scenario,
  SolverContext,
  SolverEvent,
  SolverOptions,
  SolverOutcome,
  SolverResult,
  SolverWarning,
  TimedPath,
} from "@/lib/model/types.js";
import { detectConflicts, sumOfCosts } from "@/lib/model/conflicts.js";
import { isWalkable, lookupDistance, trueDistanceFrom } from "@/lib/model/grid.js";
import { createTraceRecorder } from "../context.js";
import { checkLimits } from "../limits.js";
import { buildResult, checkAbort, defaultMaxTime, toMoveEvents } from "../shared.js";
import {
  constrainedFocalAStar,
  type CbsLowLevelStopReason,
  type ConstrainedSearchOutput,
} from "./low-level.js";

export type CbsVariant = "cbs" | "bcbs" | "ecbs" | "icbs" | "eecbs";

export interface CbsRunConfig {
  readonly variant: CbsVariant;
  readonly lowLevelWeight: number;
  readonly highLevelWeight: number;
  readonly requestedBound?: number;
  readonly optionWarnings?: readonly SolverWarning[];
  readonly optionError?: string;
}

interface CtNode {
  readonly id: string;
  readonly parentId?: string;
  readonly constraints: readonly Constraint[];
  readonly lowerBounds: readonly number[];
  readonly lowerBound: number;
  readonly sequence: number;
  readonly depth: number;
  readonly paths: readonly TimedPath[];
  readonly cost: number;
  readonly conflicts: readonly Conflict[];
}

interface Branch {
  readonly constraint: Constraint;
  readonly agentIndex: number;
  readonly node: CtNode | null;
}

interface Selection {
  readonly index: number;
  readonly node: CtNode;
  readonly lowerBound: number;
  readonly source: "open" | "focal" | "cleanup";
}

interface OnlineErrors {
  distanceSum: number;
  costSum: number;
  samples: number;
}

type StopState = "timeout" | "aborted" | "node-limit";

export async function solveCbsVariant(
  scenario: Scenario,
  options: SolverOptions,
  context: SolverContext,
  config: CbsRunConfig,
): Promise<SolverResult> {
  const startedAt = context.now();
  const recorder = createTraceRecorder(options);
  const limitCheck = checkLimits(scenario, options);
  const warnings: SolverWarning[] = [...limitCheck.warnings, ...(config.optionWarnings ?? [])];
  const emit = (event: SolverEvent) => {
    recorder.record(event);
    context.emit(event);
  };
  let expanded = 0;
  let generated = 0;
  let conflictsDetected = 0;
  let replans = 0;
  let nextNodeSequence = 0;
  let stopState: StopState | null = null;
  let sawHorizonCutoff = false;
  const onlineErrors: OnlineErrors = { distanceSum: 0, costSum: 0, samples: 0 };

  if (!limitCheck.ok) return finish(limitCheck.result!);
  if (config.optionError) return finish(errorResult(config.optionError, "invalid-scenario"));
  const validationError = validateInput(scenario);
  if (validationError) return finish(errorResult(validationError.message, validationError.code));

  const requestedHorizon = options.horizon ?? defaultMaxTime(scenario);
  const maxTime = Math.min(requestedHorizon, options.maxHorizon);
  if (requestedHorizon > options.maxHorizon) {
    warnings.push({
      code: "input-too-large",
      message: `探索 horizon を maxHorizon=${options.maxHorizon} に制限しました。`,
    });
  }

  const agents = scenario.agents as readonly (AgentSpec & {
    readonly goal: NonNullable<AgentSpec["goal"]>;
  })[];
  let initialLowerBound = 0;
  for (const agent of agents) {
    const distance = lookupDistance(
      scenario.map,
      trueDistanceFrom(scenario.map, agent.goal),
      agent.start,
    );
    if (!Number.isFinite(distance)) {
      return finish(failureResult("no-solution", "unreachable-goal"));
    }
    initialLowerBound += distance;
  }

  const rootPaths: TimedPath[] = [];
  const rootLowerBounds: number[] = [];
  for (let index = 0; index < agents.length; index += 1) {
    const agent = agents[index]!;
    const output = planAgent(agent, [], rootPaths, config.lowLevelWeight);
    generated += output.generated;
    if (!output.path || output.lowerBound === undefined) {
      const stopped = stopResultIfNeeded();
      if (stopped) return finish(stopped);
      if (output.reason === "max-time") sawHorizonCutoff = true;
      return finish(failureResult("no-solution", "search-exhausted"));
    }
    rootPaths.push(output.path);
    rootLowerBounds.push(output.lowerBound);
  }

  const root = makeNode({
    constraints: [],
    paths: rootPaths,
    lowerBounds: rootLowerBounds,
    depth: 0,
  });
  const open: CtNode[] = [root];
  emitCtNode(root);

  while (open.length > 0) {
    const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
    if (abort !== "ok") {
      stopState = abort;
      return finish(failureResult(abort, "limit-exceeded"));
    }

    const selection = selectNode(open, config, onlineErrors);
    open.splice(selection.index, 1);
    let current = selection.node;
    const highLevelStop = consumeExpansion();
    if (highLevelStop !== "ok") {
      return finish(failureResult(highLevelStop, "limit-exceeded"));
    }
    emit({
      type: "expand-node",
      state: {
        phase: "constraint-tree",
        variant: config.variant,
        nodeId: current.id,
        cost: current.cost,
        lowerBound: current.lowerBound,
        conflicts: current.conflicts.length,
        selectedFrom: selection.source,
      },
    });

    while (true) {
      if (current.conflicts.length === 0) {
        const result = buildResult(
          scenario,
          current.paths,
          context.now() - startedAt,
          expanded,
          "solved",
          {
            generatedNodes: generated,
            conflictsDetected,
            replans,
            lowerBound: Math.min(selection.lowerBound, current.cost),
          },
        );
        if (result.conflicts.length > 0) {
          return finish({
            ...result,
            outcome: "error",
            failureReason: "internal",
            error: { code: "internal", message: "CBS の解に未解消 conflict が残りました。" },
          });
        }
        for (const frame of toMoveEvents(result.paths, scenario.rules)) {
          emit({ type: "move", ...frame });
        }
        return finish(result);
      }

      let chosenConflict: Conflict;
      let branches: readonly Branch[];
      if (config.variant === "icbs") {
        const choice = classifyAndChoose(current);
        const stopped = stopResultIfNeeded();
        if (stopped) return finish(stopped);
        if (!choice) break;
        chosenConflict = choice.conflict;
        branches = choice.branches;

        if (choice.classification !== "cardinal") {
          const bypass = branches.find(
            (branch) =>
              branch.node &&
              branch.node.cost === current.cost &&
              branch.node.conflicts.length < current.conflicts.length,
          );
          if (bypass?.node) {
            // Bypass child の constraint も引き継ぐ。paths だけ親へ移すと、後続の
            // replan が bypass 前の経路を再び選べてしまう。
            current = bypass.node;
            emit({
              type: "bypass",
              agentId: agents[bypass.agentIndex]!.id,
              conflict: chosenConflict,
            });
            continue;
          }
        }
      } else {
        chosenConflict = current.conflicts[0]!;
        emit({ type: "detect-conflict", conflict: chosenConflict });
        branches = createBranches(current, chosenConflict);
        const stopped = stopResultIfNeeded();
        if (stopped) return finish(stopped);
      }

      const children = branches.flatMap((branch) => (branch.node ? [branch.node] : []));
      for (const child of children) open.push(child);
      if (config.variant === "eecbs" && children.length > 0) {
        updateOnlineErrors(current, children, onlineErrors);
      }
      break;
    }
  }

  return finish(failureResult("no-solution", "search-exhausted"));

  function planAgent(
    agent: (typeof agents)[number],
    constraints: readonly Constraint[],
    otherPaths: readonly TimedPath[],
    weight: number,
  ): ConstrainedSearchOutput {
    return constrainedFocalAStar({
      map: scenario.map,
      agent,
      rules: scenario.rules,
      constraints,
      otherPaths,
      weight,
      maxTime,
      consumeExpansion,
      onExpand: (cell, time, f, conflictCount) => {
        emit({
          type: "expand-node",
          agentId: agent.id,
          state: { phase: "cbs-low-level", cell, time, f, conflictCount },
        });
      },
    });
  }

  function consumeExpansion(): "ok" | CbsLowLevelStopReason {
    const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
    if (abort !== "ok") {
      stopState = abort;
      return abort;
    }
    if (expanded >= options.maxExpansions) {
      stopState = "node-limit";
      return "node-limit";
    }
    expanded += 1;
    return "ok";
  }

  function makeNode(input: {
    readonly parent?: CtNode;
    readonly constraints: readonly Constraint[];
    readonly paths: readonly TimedPath[];
    readonly lowerBounds: readonly number[];
    readonly depth: number;
  }): CtNode {
    const conflicts = detectConflicts(input.paths, scenario.rules);
    conflictsDetected += conflicts.length;
    const sequence = nextNodeSequence;
    nextNodeSequence += 1;
    generated += 1;
    return {
      id: `ct-${sequence}`,
      ...(input.parent ? { parentId: input.parent.id } : {}),
      constraints: input.constraints,
      paths: input.paths,
      lowerBounds: input.lowerBounds,
      lowerBound: input.lowerBounds.reduce((sum, value) => sum + value, 0),
      cost: sumOfCosts(input.paths),
      conflicts,
      sequence,
      depth: input.depth,
    };
  }

  function emitCtNode(node: CtNode): void {
    emit({
      type: "create-ct-node",
      nodeId: node.id,
      ...(node.parentId ? { parentId: node.parentId } : {}),
      cost: node.cost,
      constraintCount: node.constraints.length,
    });
  }

  function createBranches(parent: CtNode, conflict: Conflict): readonly Branch[] {
    const constraints = constraintsFor(conflict);
    const branches: Branch[] = [];
    for (const constraint of constraints) {
      emit({ type: "add-constraint", constraint });
      const agentIndex = agents.findIndex((agent) => agent.id === constraint.agentId);
      if (agentIndex < 0) {
        stopState = "node-limit";
        continue;
      }
      const agent = agents[agentIndex]!;
      const childConstraints = [...parent.constraints, constraint];
      const otherPaths = parent.paths.filter((path) => path.agentId !== agent.id);
      emit({ type: "low-level-replan", agentId: agent.id, nodeId: parent.id });
      replans += 1;
      const output = planAgent(agent, childConstraints, otherPaths, config.lowLevelWeight);
      generated += output.generated;
      if (!output.path || output.lowerBound === undefined) {
        if (output.reason === "max-time") sawHorizonCutoff = true;
        branches.push({ constraint, agentIndex, node: null });
        continue;
      }

      const paths = parent.paths.map((path, index) => (index === agentIndex ? output.path! : path));
      const lowerBounds = parent.lowerBounds.map((value, index) =>
        index === agentIndex ? output.lowerBound! : value,
      );
      const child = makeNode({
        parent,
        constraints: childConstraints,
        paths,
        lowerBounds,
        depth: parent.depth + 1,
      });
      emitCtNode(child);
      branches.push({ constraint, agentIndex, node: child });
    }
    return branches;
  }

  function classifyAndChoose(parent: CtNode): {
    readonly conflict: Conflict;
    readonly classification: "cardinal" | "semi-cardinal" | "non-cardinal";
    readonly branches: readonly Branch[];
  } | null {
    let firstSemi:
      | { conflict: Conflict; classification: "semi-cardinal"; branches: readonly Branch[] }
      | undefined;
    let firstNon:
      | { conflict: Conflict; classification: "non-cardinal"; branches: readonly Branch[] }
      | undefined;

    for (const conflict of parent.conflicts) {
      emit({ type: "detect-conflict", conflict });
      const branches = createBranches(parent, conflict);
      if (stopState) return null;
      const increases = branches.map((branch) => !branch.node || branch.node.cost > parent.cost);
      const classification =
        increases[0] && increases[1]
          ? "cardinal"
          : increases[0] || increases[1]
            ? "semi-cardinal"
            : "non-cardinal";
      emit({ type: "classify-conflict", conflict, classification });
      if (classification === "cardinal") return { conflict, classification, branches };
      if (classification === "semi-cardinal" && !firstSemi) {
        firstSemi = { conflict, classification, branches };
      } else if (classification === "non-cardinal" && !firstNon) {
        firstNon = { conflict, classification, branches };
      }
    }
    return firstSemi ?? firstNon ?? null;
  }

  function stopResultIfNeeded(): SolverResult | null {
    if (!stopState) return null;
    return failureResult(stopState, "limit-exceeded");
  }

  function errorResult(
    message: string,
    code: "invalid-scenario" | "unsupported-rules",
  ): SolverResult {
    return {
      outcome: "error",
      paths: [],
      metrics: { sumOfCosts: 0, makespan: 0, runtimeMs: context.now() - startedAt },
      conflicts: [],
      error: { code, message },
      failureReason: code === "unsupported-rules" ? "unsupported-rules" : "internal",
    };
  }

  function failureResult(
    outcome: Exclude<SolverOutcome, "solved" | "error">,
    failureReason: FailureReason,
  ): SolverResult {
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
        replans,
        ...(initialLowerBound > 0 ? { lowerBound: initialLowerBound } : {}),
      },
      conflicts: [],
      failureReason,
    };
  }

  function finish(base: SolverResult): SolverResult {
    if (sawHorizonCutoff) {
      warnings.push({
        code: "simplified-behavior",
        message: `有限 horizon ${maxTime} までに必要な低レベル path を見つけられませんでした。理論上の完全性はこの打切りには適用されません。`,
      });
    }
    const beforeTrace = mergeWarnings(base.warnings, warnings);
    const eventResult: SolverResult = {
      ...base,
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

function selectNode(
  open: readonly CtNode[],
  config: CbsRunConfig,
  errors: OnlineErrors,
): Selection {
  if (config.variant === "cbs" || config.variant === "icbs") {
    const index = bestIndex(open, compareCbs);
    const node = open[index]!;
    return { index, node, lowerBound: node.cost, source: "open" };
  }

  if (config.variant === "bcbs") {
    const minimumCost = open.reduce((minimum, node) => Math.min(minimum, node.cost), Infinity);
    const eligible = indicesWhere(
      open,
      (node) => node.cost <= config.highLevelWeight * minimumCost + 1e-9,
    );
    const index = bestIndexFrom(open, eligible, compareFocalNode);
    return {
      index,
      node: open[index]!,
      lowerBound: minimumCost / config.lowLevelWeight,
      source: "focal",
    };
  }

  const cleanupIndex = bestIndex(open, compareCleanup);
  const cleanup = open[cleanupIndex]!;
  if (config.variant === "ecbs") {
    const eligible = indicesWhere(
      open,
      (node) => node.cost <= config.highLevelWeight * cleanup.lowerBound + 1e-9,
    );
    const index = bestIndexFrom(open, eligible, compareFocalNode);
    return { index, node: open[index]!, lowerBound: cleanup.lowerBound, source: "focal" };
  }

  const openIndex = bestIndex(open, (a, b) => compareEstimated(a, b, errors));
  const bestEstimated = open[openIndex]!;
  const minimumEstimate = estimatedCost(bestEstimated, errors);
  const focalIndices = indicesWhere(open, (node) => {
    if (!Number.isFinite(minimumEstimate)) return true;
    return estimatedCost(node, errors) <= config.highLevelWeight * minimumEstimate + 1e-9;
  });
  const focalIndex = bestIndexFrom(open, focalIndices, (a, b) => compareDistance(a, b, errors));
  const bestDistance = open[focalIndex]!;
  const costThreshold = config.highLevelWeight * cleanup.lowerBound + 1e-9;
  if (bestDistance.cost <= costThreshold) {
    return {
      index: focalIndex,
      node: bestDistance,
      lowerBound: cleanup.lowerBound,
      source: "focal",
    };
  }
  if (bestEstimated.cost <= costThreshold) {
    return {
      index: openIndex,
      node: bestEstimated,
      lowerBound: cleanup.lowerBound,
      source: "open",
    };
  }
  return {
    index: cleanupIndex,
    node: cleanup,
    lowerBound: cleanup.lowerBound,
    source: "cleanup",
  };
}

function compareCbs(a: CtNode, b: CtNode): number {
  return a.cost - b.cost || a.conflicts.length - b.conflicts.length || a.sequence - b.sequence;
}

function compareFocalNode(a: CtNode, b: CtNode): number {
  return a.conflicts.length - b.conflicts.length || a.cost - b.cost || a.sequence - b.sequence;
}

function compareCleanup(a: CtNode, b: CtNode): number {
  return a.lowerBound - b.lowerBound || a.cost - b.cost || compareFocalNode(a, b);
}

function compareEstimated(a: CtNode, b: CtNode, errors: OnlineErrors): number {
  return (
    compareNumber(estimatedCost(a, errors), estimatedCost(b, errors)) ||
    a.conflicts.length - b.conflicts.length ||
    a.cost - b.cost ||
    a.sequence - b.sequence
  );
}

function compareDistance(a: CtNode, b: CtNode, errors: OnlineErrors): number {
  return (
    a.conflicts.length - b.conflicts.length ||
    compareNumber(estimatedCost(a, errors), estimatedCost(b, errors)) ||
    a.cost - b.cost ||
    a.sequence - b.sequence
  );
}

function estimatedCost(node: CtNode, errors: OnlineErrors): number {
  if (node.conflicts.length === 0 || errors.samples === 0) return node.cost;
  const meanDistanceError = errors.distanceSum / errors.samples;
  const meanCostError = errors.costSum / errors.samples;
  if (meanDistanceError >= 1) return Number.POSITIVE_INFINITY;
  const estimate = node.cost + (node.conflicts.length / (1 - meanDistanceError)) * meanCostError;
  return Math.max(node.cost, estimate);
}

function updateOnlineErrors(
  parent: CtNode,
  children: readonly CtNode[],
  errors: OnlineErrors,
): void {
  const best = children.reduce((current, candidate) =>
    compareEstimated(candidate, current, errors) < 0 ? candidate : current,
  );
  errors.distanceSum += best.conflicts.length - (parent.conflicts.length - 1);
  errors.costSum += best.cost - parent.cost;
  errors.samples += 1;
}

function bestIndex(nodes: readonly CtNode[], compare: (a: CtNode, b: CtNode) => number): number {
  let index = 0;
  for (let candidate = 1; candidate < nodes.length; candidate += 1) {
    if (compare(nodes[candidate]!, nodes[index]!) < 0) index = candidate;
  }
  return index;
}

function bestIndexFrom(
  nodes: readonly CtNode[],
  indices: readonly number[],
  compare: (a: CtNode, b: CtNode) => number,
): number {
  let best = indices[0] ?? 0;
  for (let position = 1; position < indices.length; position += 1) {
    const candidate = indices[position]!;
    if (compare(nodes[candidate]!, nodes[best]!) < 0) best = candidate;
  }
  return best;
}

function indicesWhere(nodes: readonly CtNode[], predicate: (node: CtNode) => boolean): number[] {
  const indices: number[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    if (predicate(nodes[index]!)) indices.push(index);
  }
  return indices;
}

function compareNumber(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function constraintsFor(conflict: Conflict): readonly Constraint[] {
  if (conflict.kind === "vertex") {
    return [
      { kind: "vertex", agentId: conflict.agentA, cell: conflict.cell, time: conflict.time },
      { kind: "vertex", agentId: conflict.agentB, cell: conflict.cell, time: conflict.time },
    ];
  }
  if (conflict.kind === "edge-swap") {
    return [
      {
        kind: "edge",
        agentId: conflict.agentA,
        from: conflict.from,
        to: conflict.to,
        time: conflict.time,
      },
      {
        kind: "edge",
        agentId: conflict.agentB,
        from: conflict.to,
        to: conflict.from,
        time: conflict.time,
      },
    ];
  }
  return [
    { kind: "vertex", agentId: conflict.agentA, cell: conflict.cell, time: conflict.time },
    { kind: "vertex", agentId: conflict.agentB, cell: conflict.cell, time: conflict.time - 1 },
  ];
}

function validateInput(
  scenario: Scenario,
): { readonly message: string; readonly code: "invalid-scenario" | "unsupported-rules" } | null {
  if (scenario.kind !== "one-shot-mapf") {
    return {
      message: "CBS 系 Solver は one-shot MAPF のみに対応しています。",
      code: "unsupported-rules",
    };
  }
  if (scenario.rules.allowDiagonal) {
    return { message: "この実装は 4 近傍 grid のみに対応しています。", code: "unsupported-rules" };
  }
  if (scenario.rules.forbidFollowing) {
    return {
      message: "following conflict 禁止は今回の CBS 証明モデルに含まれません。",
      code: "unsupported-rules",
    };
  }
  if (scenario.rules.goalBehavior !== "stay") {
    return {
      message: "今回の CBS 系実装は stay at goal のみに対応しています。",
      code: "unsupported-rules",
    };
  }
  if (scenario.agents.length === 0) {
    return { message: "エージェントが 1 体もありません。", code: "invalid-scenario" };
  }
  const ids = new Set<string>();
  for (const agent of scenario.agents) {
    if (ids.has(agent.id)) {
      return { message: `agent ID ${agent.id} が重複しています。`, code: "invalid-scenario" };
    }
    ids.add(agent.id);
    if (!agent.goal) {
      return { message: `${agent.id} に goal が設定されていません。`, code: "invalid-scenario" };
    }
    if (!isWalkable(scenario.map, agent.start) || !isWalkable(scenario.map, agent.goal)) {
      return {
        message: `${agent.id} の start または goal が通行不能です。`,
        code: "invalid-scenario",
      };
    }
  }
  return null;
}

function mergeWarnings(
  ...groups: readonly (readonly SolverWarning[] | undefined)[]
): SolverWarning[] {
  const output: SolverWarning[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const warning of group ?? []) {
      const key = `${warning.code}\u0000${warning.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(warning);
    }
  }
  return output;
}
