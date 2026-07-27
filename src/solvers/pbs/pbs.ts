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
import { detectConflicts, firstConflict, sumOfCosts } from "@/lib/model/conflicts.js";
import { isWalkable, lookupDistance, trueDistanceFrom } from "@/lib/model/grid.js";
import { buildReservationTable } from "@/lib/model/reservation.js";
import { createTraceRecorder } from "../context.js";
import { checkLimits } from "../limits.js";
import { buildResult, checkAbort, defaultMaxTime, toMoveEvents } from "../shared.js";
import type { LowLevelStopReason } from "../low-level/space-time-astar.js";
import { pbsLowLevelAStar } from "./low-level.js";

interface PriorityEdge {
  readonly higher: string;
  readonly lower: string;
}

interface PtNode {
  readonly id: string;
  readonly edges: readonly PriorityEdge[];
  readonly paths: ReadonlyMap<string, TimedPath>;
  readonly cost: number;
  readonly depth: number;
  readonly sequence: number;
}

type StopState = "timeout" | "aborted" | "node-limit" | null;

export const pbsSolver: MapfSolver = {
  metadata: {
    id: "pbs",
    displayName: "PBS（優先度ベース探索）",
    originalName: "Priority-Based Search",
    category: "prioritized-planning",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "reference-validated",
    unsupportedRules: ["allowDiagonal", "forbidFollowing", "goalBehavior"],
    basedOnPaperIds: ["pbs-aaai-2019"],
    validatedAgainst: [
      "Jiaoyang-Li/PBS d7b91fa5 (Space-Time A* low level): 3x2 empty swap fixture で success、SOC=6、makespan=4、path validity を比較。",
    ],
    implementationNote:
      "Algorithm 2 の priority-tree DFS、partial-order UpdatePlan、2 段 CAT tie-break を独立実装。finite maxHorizon と row-major 最終 tie-break はブラウザ用の明示的な打切り・決定性規則。",
  },

  async solve(scenario, options, context): Promise<SolverResult> {
    return solvePbs(scenario, options, context);
  },
};

async function solvePbs(
  scenario: Scenario,
  options: SolverOptions,
  context: SolverContext,
): Promise<SolverResult> {
  const startedAt = context.now();
  const recorder = createTraceRecorder(options);
  const limitCheck = checkLimits(scenario, options);
  const warnings: SolverWarning[] = [
    ...limitCheck.warnings,
    ...(options.suboptimalityFactor !== undefined
      ? [
          {
            code: "option-ignored" as const,
            message: "PBS は suboptimalityFactor を使用しません。",
          },
        ]
      : []),
  ];
  const emit = (event: SolverEvent): void => {
    recorder.record(event);
    context.emit(event);
  };

  let expanded = 0;
  let generated = 0;
  let conflictsDetected = 0;
  let replans = 0;
  let nextNodeSequence = 0;
  let stopState: StopState = null;
  let sawHorizonCutoff = false;

  if (!limitCheck.ok) return finish(limitCheck.result!);
  const validation = validateScenario(scenario);
  if (validation) return finish(errorResult(validation.message, validation.code));

  const agents = scenario.agents as readonly (AgentSpec & { readonly goal: Cell })[];
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const orderIndex = new Map(agents.map((agent, index) => [agent.id, index]));
  const heuristics = new Map(
    agents.map((agent) => [agent.id, trueDistanceFrom(scenario.map, agent.goal)]),
  );
  let lowerBound = 0;
  for (const agent of agents) {
    const distance = lookupDistance(scenario.map, heuristics.get(agent.id)!, agent.start);
    if (!Number.isFinite(distance)) {
      return finish(failureResult("no-solution", "unreachable-goal"));
    }
    lowerBound += distance;
  }

  const initialEdgesResult = parseInitialPriority(options.extra?.initialPriority, byId);
  if ("error" in initialEdgesResult) {
    return finish(errorResult(initialEdgesResult.error, "invalid-scenario"));
  }
  const initialEdges = initialEdgesResult.edges;
  if (
    hasCycle(
      initialEdges,
      agents.map((agent) => agent.id),
    )
  ) {
    return finish(errorResult("extra.initialPriority が cycle を含みます。", "invalid-scenario"));
  }

  const requestedMaxTime = options.horizon ?? defaultMaxTime(scenario);
  const maxTime = Math.min(requestedMaxTime, options.maxHorizon);
  if (requestedMaxTime > options.maxHorizon) {
    warnings.push({
      code: "input-too-large",
      message: `PBS の探索 horizon を maxHorizon=${options.maxHorizon} に制限しました。`,
    });
  }

  const rootPaths = new Map<string, TimedPath>();
  const rootOrder = topologicalOrder(
    agents.map((agent) => agent.id),
    initialEdges,
    orderIndex,
  );
  for (const agentId of rootOrder) {
    const output = planAgent(agentId, initialEdges, rootPaths);
    generated += output.generated;
    if (!output.path) {
      const stopped = stopResultIfNeeded();
      if (stopped) return finish(stopped);
      if (output.reason === "max-time") sawHorizonCutoff = true;
      return finish(
        noSolutionResult(initialEdges.length > 0 ? "priority-order" : "search-exhausted"),
      );
    }
    rootPaths.set(agentId, output.path);
  }

  const root = makeNode(initialEdges, rootPaths, 0);
  const stack: PtNode[] = [root];
  emitDag(root.edges);

  while (stack.length > 0) {
    const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
    if (abort !== "ok") {
      stopState = abort;
      return finish(failureResult(abort, "limit-exceeded"));
    }
    const current = stack.pop()!;
    const highLevelStop = consumeExpansion();
    if (highLevelStop !== "ok") {
      return finish(
        failureResult(
          highLevelStop === "max-expansions" ? "node-limit" : highLevelStop,
          "limit-exceeded",
        ),
      );
    }
    emit({
      type: "expand-node",
      state: {
        phase: "priority-tree",
        nodeId: current.id,
        depth: current.depth,
        cost: current.cost,
        priorityEdges: current.edges.length,
      },
    });

    const orderedPaths = agents.map((agent) => current.paths.get(agent.id)!);
    const conflict = firstConflict(orderedPaths, scenario.rules);
    if (!conflict) {
      const result = buildResult(
        scenario,
        orderedPaths,
        context.now() - startedAt,
        expanded,
        "solved",
        { generatedNodes: generated, conflictsDetected, replans, lowerBound },
      );
      if (result.conflicts.length > 0) {
        return finish({
          ...result,
          outcome: "error",
          failureReason: "internal",
          error: { code: "internal", message: "PBS の解に未解消 conflict が残りました。" },
        });
      }
      for (const frame of toMoveEvents(result.paths, scenario.rules)) {
        emit({ type: "move", ...frame });
      }
      return finish(result);
    }

    conflictsDetected += 1;
    emit({ type: "detect-conflict", conflict });
    const first = conflict.agentA;
    const second = conflict.agentB;
    if (reaches(current.edges, first, second) || reaches(current.edges, second, first)) {
      return finish({
        ...failureResult("no-solution", "internal"),
        outcome: "error",
        error: {
          code: "internal",
          message: "PBS invariant に反し、comparable agents 間に conflict が残りました。",
        },
      });
    }

    const children: PtNode[] = [];
    for (const [higher, lower] of [
      [first, second],
      [second, first],
    ] as const) {
      const edges = addEdge(current.edges, { higher, lower });
      if (
        hasCycle(
          edges,
          agents.map((agent) => agent.id),
        )
      )
        continue;
      emit({ type: "set-priority", higher, lower });
      emitDag(edges);
      const paths = new Map(current.paths);
      const updated = updatePlan(lower, edges, paths);
      if (!updated) {
        const stopped = stopResultIfNeeded();
        if (stopped) return finish(stopped);
        continue;
      }
      children.push(makeNode(edges, paths, current.depth + 1));
    }

    // Algorithm 2 line 23: non-increasing cost で push し、stack top は最小 cost。
    children.sort((a, b) => b.cost - a.cost || a.sequence - b.sequence);
    for (const child of children) stack.push(child);
  }

  return finish(noSolutionResult("search-exhausted"));

  /**
   * PBS が解を返せなかったときの但し書き。
   *
   * ★ PBS が探索するのは「ある全順序と整合する解」だけなので、
   *   優先度木を枯渇させても、MAPF インスタンスに解が無いことの証明にはならない。
   *   実例: 幅 5 の通路に待避ポケットが 1 つだけある入れ替え問題では、
   *   CBS が sum of costs 11 で解く一方、PBS は両方の順序が破綻して枯渇する。
   *   これを黙って "no-solution" とだけ返すと過大主張になる（SOURCE_POLICY.md 第 8 条）。
   *
   * ★ unreachable-goal だけは例外で、本当に解が無いことの証明なので呼ばない。
   */
  function noSolutionResult(failureReason: FailureReason): SolverResult {
    warnings.push({
      code: "simplified-behavior",
      message:
        "PBS は優先順位の全順序と整合する解だけを探索します。探索を尽くしても、この問題に解が存在しないことの証明にはなりません。",
    });
    if (sawHorizonCutoff) {
      warnings.push({
        code: "input-too-large",
        message: `低レベル探索を horizon ${maxTime} で打ち切りました。より長い経路が必要な解は探索できていません。`,
      });
    }
    return failureResult("no-solution", failureReason);
  }

  function updatePlan(
    startAgentId: string,
    edges: readonly PriorityEdge[],
    paths: Map<string, TimedPath>,
  ): boolean {
    const affected = agents
      .map((agent) => agent.id)
      .filter((id) => id === startAgentId || reaches(edges, startAgentId, id));
    const ordered = topologicalOrder(affected, edges, orderIndex);
    for (const agentId of ordered) {
      const higherIds = agents
        .map((agent) => agent.id)
        .filter((id) => id !== agentId && reaches(edges, id, agentId));
      const currentPath = paths.get(agentId);
      const collidesWithHigher =
        currentPath !== undefined &&
        higherIds.some((higherId) => {
          const higherPath = paths.get(higherId);
          return higherPath
            ? detectConflicts([higherPath, currentPath], scenario.rules, 1).length > 0
            : false;
        });
      if (agentId !== startAgentId && !collidesWithHigher) continue;

      emit({ type: "replan-lower-priority-agent", agentId });
      emit({ type: "replan", agentIds: [agentId], reason: "PBS UpdatePlan" });
      replans += 1;
      const output = planAgent(agentId, edges, paths);
      generated += output.generated;
      if (!output.path) {
        if (output.reason === "max-time") sawHorizonCutoff = true;
        return false;
      }
      paths.set(agentId, output.path);
    }
    return true;
  }

  function planAgent(
    agentId: string,
    edges: readonly PriorityEdge[],
    paths: ReadonlyMap<string, TimedPath>,
  ) {
    const agent = byId.get(agentId)!;
    const higherPaths: TimedPath[] = [];
    const incomparablePaths: TimedPath[] = [];
    const lowerPaths: TimedPath[] = [];
    for (const other of agents) {
      if (other.id === agentId) continue;
      const path = paths.get(other.id);
      if (!path) continue;
      if (reaches(edges, other.id, agentId)) higherPaths.push(path);
      else if (reaches(edges, agentId, other.id)) lowerPaths.push(path);
      else incomparablePaths.push(path);
    }
    const reservations = buildReservationTable(higherPaths, maxTime, scenario.rules);
    return pbsLowLevelAStar({
      map: scenario.map,
      agent,
      rules: scenario.rules,
      hardReservations: reservations,
      incomparablePaths,
      lowerPaths,
      heuristic: heuristics.get(agentId)!,
      maxTime,
      consumeExpansion,
      onExpand: (cell, time, f, incomparableConflicts, lowerConflicts) => {
        emit({
          type: "expand-node",
          agentId,
          state: {
            phase: "pbs-low-level",
            cell,
            time,
            f,
            incomparableConflicts,
            lowerConflicts,
          },
        });
      },
    });
  }

  function makeNode(
    edges: readonly PriorityEdge[],
    paths: ReadonlyMap<string, TimedPath>,
    depth: number,
  ): PtNode {
    const sequence = nextNodeSequence;
    nextNodeSequence += 1;
    generated += 1;
    return {
      id: `pt-${sequence}`,
      edges,
      paths: new Map(paths),
      cost: sumOfCosts(agents.map((agent) => paths.get(agent.id)!)),
      depth,
      sequence,
    };
  }

  function emitDag(edges: readonly PriorityEdge[]): void {
    emit({ type: "update-priority-dag", edges });
  }

  function consumeExpansion(): "ok" | LowLevelStopReason {
    const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
    if (abort !== "ok") {
      stopState = abort;
      return abort;
    }
    if (expanded >= options.maxExpansions) {
      stopState = "node-limit";
      return "max-expansions";
    }
    expanded += 1;
    return "ok";
  }

  function stopResultIfNeeded(): SolverResult | null {
    if (stopState === "timeout" || stopState === "aborted") {
      return failureResult(stopState, "limit-exceeded");
    }
    if (stopState === "node-limit") return failureResult("node-limit", "limit-exceeded");
    return null;
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

  function failureResult(outcome: SolverOutcome, failureReason: FailureReason): SolverResult {
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
      },
      conflicts: [],
      failureReason,
    };
  }

  function finish(base: SolverResult): SolverResult {
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

function validateScenario(
  scenario: Scenario,
): { readonly code: "invalid-scenario" | "unsupported-rules"; readonly message: string } | null {
  if (scenario.kind !== "one-shot-mapf") {
    return { code: "unsupported-rules", message: "PBS は one-shot MAPF のみに対応しています。" };
  }
  if (scenario.rules.allowDiagonal || scenario.rules.forbidFollowing) {
    return {
      code: "unsupported-rules",
      message: "PBS は 4 近傍・following conflict 許可の原論文モデルだけに対応します。",
    };
  }
  if (scenario.rules.goalBehavior !== "stay") {
    return {
      code: "unsupported-rules",
      message: "PBS の low level は higher agent が goal に留まるモデルを必要とします。",
    };
  }
  if (scenario.agents.length === 0) {
    return { code: "invalid-scenario", message: "エージェントが 1 体もありません。" };
  }
  const ids = new Set<string>();
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
  }
  return null;
}

function parseInitialPriority(
  raw: unknown,
  agents: ReadonlyMap<string, AgentSpec>,
): { readonly edges: readonly PriorityEdge[] } | { readonly error: string } {
  if (raw === undefined) return { edges: [] };
  if (!Array.isArray(raw)) {
    return { error: "extra.initialPriority は {higher, lower} の配列で指定してください。" };
  }
  const edges: PriorityEdge[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "object" || value === null) {
      return { error: "extra.initialPriority の各要素は {higher, lower} です。" };
    }
    const item = value as { readonly higher?: unknown; readonly lower?: unknown };
    if (typeof item.higher !== "string" || typeof item.lower !== "string") {
      return { error: "extra.initialPriority の higher / lower は agent ID 文字列です。" };
    }
    if (!agents.has(item.higher) || !agents.has(item.lower)) {
      return { error: `extra.initialPriority に未知の agent ID があります。` };
    }
    if (item.higher === item.lower) {
      return { error: "agent を自分自身より高い priority にはできません。" };
    }
    const key = `${item.higher}\u0000${item.lower}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push({ higher: item.higher, lower: item.lower });
    }
  }
  return { edges };
}

function addEdge(edges: readonly PriorityEdge[], edge: PriorityEdge): readonly PriorityEdge[] {
  return edges.some(
    (candidate) => candidate.higher === edge.higher && candidate.lower === edge.lower,
  )
    ? edges
    : [...edges, edge];
}

function reaches(edges: readonly PriorityEdge[], from: string, to: string): boolean {
  if (from === to) return false;
  const stack = [from];
  const seen = new Set<string>([from]);
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const edge of edges) {
      if (edge.higher !== current) continue;
      if (edge.lower === to) return true;
      if (!seen.has(edge.lower)) {
        seen.add(edge.lower);
        stack.push(edge.lower);
      }
    }
  }
  return false;
}

function hasCycle(edges: readonly PriorityEdge[], agentIds: readonly string[]): boolean {
  return agentIds.some(
    (id) => reaches(edges, id, id) || cycleFrom(id, edges, new Set(), new Set()),
  );
}

function cycleFrom(
  id: string,
  edges: readonly PriorityEdge[],
  visiting: Set<string>,
  visited: Set<string>,
): boolean {
  if (visiting.has(id)) return true;
  if (visited.has(id)) return false;
  visiting.add(id);
  for (const edge of edges) {
    if (edge.higher === id && cycleFrom(edge.lower, edges, visiting, visited)) return true;
  }
  visiting.delete(id);
  visited.add(id);
  return false;
}

function topologicalOrder(
  ids: readonly string[],
  edges: readonly PriorityEdge[],
  orderIndex: ReadonlyMap<string, number>,
): string[] {
  const included = new Set(ids);
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const edge of edges) {
    if (included.has(edge.higher) && included.has(edge.lower)) {
      indegree.set(edge.lower, (indegree.get(edge.lower) ?? 0) + 1);
    }
  }
  const ready = ids
    .filter((id) => indegree.get(id) === 0)
    .sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
  const out: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift()!;
    out.push(current);
    for (const edge of edges) {
      if (edge.higher !== current || !included.has(edge.lower)) continue;
      const next = (indegree.get(edge.lower) ?? 0) - 1;
      indegree.set(edge.lower, next);
      if (next === 0) {
        ready.push(edge.lower);
        ready.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
      }
    }
  }
  return out;
}

function mergeWarnings(
  ...groups: readonly (readonly SolverWarning[] | undefined)[]
): SolverWarning[] {
  const out: SolverWarning[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const warning of group ?? []) {
      const key = `${warning.code}\u0000${warning.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(warning);
    }
  }
  return out;
}
