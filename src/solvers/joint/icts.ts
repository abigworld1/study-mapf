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
import { createTraceRecorder } from "../context.js";
import { checkLimits } from "../limits.js";
import { buildResult, checkAbort, defaultMaxTime } from "../shared.js";

interface Mdd {
  readonly layers: readonly (readonly number[])[];
  readonly successors: readonly ReadonlyMap<number, readonly number[]>[];
  readonly nodeCount: number;
}

type StopState = "timeout" | "aborted" | "node-limit" | null;

export const ictsSolver: MapfSolver = {
  metadata: {
    id: "icts",
    displayName: "ICTS（Increasing Cost Tree Search）",
    originalName: "Increasing Cost Tree Search",
    category: "icts-joint-mstar",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: ["allowDiagonal", "goalBehavior"],
    basedOnPaperIds: ["icts-ijcai-2011"],
    implementationNote:
      "IJCAI 2011 Algorithm 1 の ICT breadth-first search、exact-cost MDD、k-agent MDD search と optional pairwise pruning を実装。Independence Detection と AIJ 拡張版固有の改良は未対応。",
  },

  async solve(scenario, options, context): Promise<SolverResult> {
    return solveIcts(scenario, options, context);
  },
};

async function solveIcts(
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
  let stopState: StopState = null;

  if (!limits.ok) return finish(limits.result!);
  const validation = validateScenario(scenario);
  if (validation) return finish(errorResult(validation.code, validation.message));

  const agents = scenario.agents as readonly (AgentSpec & { readonly goal: Cell })[];
  const distances = agents.map((agent) => trueDistanceFrom(scenario.map, agent.goal));
  const rootCosts: number[] = [];
  for (let index = 0; index < agents.length; index += 1) {
    const distance = lookupDistance(scenario.map, distances[index]!, agents[index]!.start);
    if (!Number.isFinite(distance)) {
      return finish(failureResult("no-solution", "unreachable-goal"));
    }
    rootCosts.push(distance);
  }

  const maxCostResult = resolveMaxIndividualCost(scenario, options);
  if ("error" in maxCostResult) {
    return finish(errorResult("invalid-scenario", maxCostResult.error));
  }
  const maxIndividualCost = maxCostResult.value;
  if (rootCosts.some((cost) => cost > maxIndividualCost)) {
    warnings.push({
      code: "input-too-large",
      message: `個別最短距離が探索上限 ${maxIndividualCost} を超えています。`,
    });
    return finish(failureResult("node-limit", "limit-exceeded"));
  }
  const pairwiseResult = resolvePairwisePruning(options);
  if ("error" in pairwiseResult) {
    return finish(errorResult("invalid-scenario", pairwiseResult.error));
  }
  const pairwisePruning = pairwiseResult.value;

  const queue: number[][] = [rootCosts];
  const seen = new Set<string>([rootCosts.join(",")]);
  let head = 0;
  let horizonCutoff = false;
  generated = 1;

  while (head < queue.length) {
    const abort = consumeExpansion();
    if (abort !== "ok") return finish(failureResult(abort, "limit-exceeded"));
    const costs = queue[head++]!;
    const nodeId = `ict-${head - 1}`;
    const totalCost = costs.reduce((sum, cost) => sum + cost, 0);
    emit({ type: "create-ict-node", nodeId, costs, totalCost });
    emit({
      type: "progress",
      ratio: Math.min(0.99, head / Math.max(head + queue.length, 1)),
      label: nodeId,
    });

    const jointDepth = Math.max(...costs);
    const mdds: Mdd[] = [];
    let validMdds = true;
    for (let index = 0; index < agents.length; index += 1) {
      const mdd = buildMdd(index, costs[index]!, jointDepth);
      if (!mdd) {
        validMdds = false;
        break;
      }
      mdds.push(mdd);
      emit({
        type: "build-mdd",
        agentId: agents[index]!.id,
        cost: costs[index]!,
        nodeCount: mdd.nodeCount,
      });
    }

    if (validMdds) {
      let pairwiseFeasible = true;
      if (pairwisePruning && agents.length > 2) {
        for (let first = 0; first < agents.length && pairwiseFeasible; first += 1) {
          for (let second = first + 1; second < agents.length; second += 1) {
            if (!searchMdds([mdds[first]!, mdds[second]!], [first, second], false)) {
              if (stopState) return finish(failureResult(stopState, "limit-exceeded"));
              pairwiseFeasible = false;
              emit({ type: "prune-ict-node", nodeId, reason: "pairwise" });
              break;
            }
          }
        }
      }
      if (pairwiseFeasible) {
        const configurations = searchMdds(
          mdds,
          agents.map((_, index) => index),
          true,
        );
        if (stopState) return finish(failureResult(stopState, "limit-exceeded"));
        if (configurations) {
          const paths = configurationsToPaths(configurations);
          const base = buildResult(scenario, paths, context.now() - startedAt, expanded, "solved", {
            generatedNodes: generated,
            conflictsDetected,
            lowerBound: totalCost,
          });
          if (base.conflicts.length > 0 || base.metrics.sumOfCosts !== totalCost) {
            return finish(internalError("ICTS の MDD 復元結果が cost vector と一致しません。"));
          }
          for (let time = 1; time < configurations.length; time += 1) {
            const positions: Record<string, Cell> = {};
            for (let index = 0; index < agents.length; index += 1) {
              positions[agents[index]!.id] = indexToCell(
                scenario.map,
                configurations[time]![index]!,
              );
            }
            emit({ type: "move", time, positions });
          }
          return finish(base);
        }
      }
    }

    for (let index = 0; index < agents.length; index += 1) {
      if (costs[index]! >= maxIndividualCost) {
        horizonCutoff = true;
        emit({ type: "prune-ict-node", nodeId, reason: "horizon" });
        continue;
      }
      const child = costs.slice();
      child[index] = child[index]! + 1;
      const key = child.join(",");
      if (seen.has(key)) {
        emit({ type: "prune-ict-node", nodeId, reason: "duplicate" });
        continue;
      }
      seen.add(key);
      queue.push(child);
      generated += 1;
    }
  }

  if (horizonCutoff) {
    warnings.push({
      code: "input-too-large",
      message: `ICTS は個別コスト上限 ${maxIndividualCost} で探索を打ち切りました。解の非存在を証明した結果ではありません。`,
    });
    return finish(failureResult("node-limit", "limit-exceeded"));
  }
  return finish(failureResult("no-solution", "search-exhausted"));

  function buildMdd(agentIndex: number, exactCost: number, jointDepth: number): Mdd | null {
    const agent = agents[agentIndex]!;
    const layers: number[][] = [[cellIndex(scenario.map, agent.start)]];
    for (let time = 0; time < exactCost; time += 1) {
      const next = new Set<number>();
      for (const current of layers[time]!) {
        for (const cell of orderedMoves(indexToCell(scenario.map, current))) {
          const remaining = exactCost - time - 1;
          if (lookupDistance(scenario.map, distances[agentIndex]!, cell) <= remaining) {
            next.add(cellIndex(scenario.map, cell));
          }
        }
      }
      const ordered = [...next].sort((left, right) => left - right);
      if (ordered.length === 0) return null;
      layers.push(ordered);
    }
    const goalIndex = cellIndex(scenario.map, agent.goal);
    if (!layers[exactCost]!.includes(goalIndex)) return null;
    layers[exactCost] = [goalIndex];
    for (let time = exactCost + 1; time <= jointDepth; time += 1) layers.push([goalIndex]);

    const successors: Map<number, readonly number[]>[] = [];
    for (let time = 0; time < jointDepth; time += 1) {
      const allowed = new Set(layers[time + 1]!);
      const map = new Map<number, readonly number[]>();
      for (const current of layers[time]!) {
        const next = orderedMoves(indexToCell(scenario.map, current))
          .map((cell) => cellIndex(scenario.map, cell))
          .filter((value) => allowed.has(value));
        map.set(current, next);
      }
      successors.push(map);
    }
    return {
      layers,
      successors,
      nodeCount: layers.reduce((sum, layer) => sum + layer.length, 0),
    };
  }

  function searchMdds(
    mdds: readonly Mdd[],
    agentIndices: readonly number[],
    keepPath: false,
  ): boolean;
  function searchMdds(
    mdds: readonly Mdd[],
    agentIndices: readonly number[],
    keepPath: true,
  ): number[][] | false;
  function searchMdds(
    mdds: readonly Mdd[],
    agentIndices: readonly number[],
    keepPath: boolean,
  ): number[][] | boolean {
    const depth = mdds[0]?.layers.length ? mdds[0]!.layers.length - 1 : 0;
    const starts = mdds.map((mdd) => mdd.layers[0]![0]!);
    const path = [starts];
    const dead = new Set<string>();

    const dfs = (time: number, current: readonly number[]): boolean => {
      const abort = consumeExpansion();
      if (abort !== "ok") return false;
      if (time === depth) return true;
      const key = `${time}|${current.join(",")}`;
      if (dead.has(key)) return false;
      const next = new Array<number>(mdds.length);

      const assign = (offset: number): boolean => {
        if (offset === mdds.length) {
          path.push(next.slice());
          if (dfs(time + 1, next)) return true;
          path.pop();
          return false;
        }
        const choices = mdds[offset]!.successors[time]!.get(current[offset]!) ?? [];
        for (const candidate of choices) {
          generated += 1;
          let conflict = false;
          for (let previous = 0; previous < offset; previous += 1) {
            if (next[previous] === candidate) {
              conflict = true;
              break;
            }
            if (
              scenario.rules.forbidEdgeSwap &&
              current[previous] === candidate &&
              current[offset] === next[previous] &&
              current[offset] !== candidate
            ) {
              conflict = true;
              break;
            }
            /*
              ★ following は非対称なので両方向を見る。
                current が時刻 t、next が t+1 の配置。
                「A が t+1 に居るセルを、B が t に居て t+1 に空けた」が条件。
            */
            if (
              scenario.rules.forbidFollowing &&
              ((candidate === current[previous] && next[previous] !== current[previous]) ||
                (next[previous] === current[offset] && candidate !== current[offset]))
            ) {
              conflict = true;
              break;
            }
          }
          if (conflict) {
            conflictsDetected += 1;
            if (keepPath) {
              const first = next.findIndex((value, i) => i < offset && value === candidate);
              if (first >= 0) {
                emit({
                  type: "detect-conflict",
                  conflict: {
                    kind: "vertex",
                    agentA: agents[agentIndices[first]!]!.id,
                    agentB: agents[agentIndices[offset]!]!.id,
                    cell: indexToCell(scenario.map, candidate),
                    time: time + 1,
                  },
                });
              }
            }
            continue;
          }
          next[offset] = candidate;
          if (assign(offset + 1)) return true;
        }
        return false;
      };

      if (assign(0)) return true;
      dead.add(key);
      return false;
    };

    return dfs(0, starts)
      ? keepPath
        ? path.map((configuration) => configuration.slice())
        : true
      : false;
  }

  function configurationsToPaths(configurations: readonly (readonly number[])[]): TimedPath[] {
    return agents.map((agent, index) => ({
      agentId: agent.id,
      positions: configurations.map((configuration, time) => ({
        cell: indexToCell(scenario.map, configuration[index]!),
        time,
      })),
    }));
  }

  function orderedMoves(cell: Cell): Cell[] {
    return movesWithWait(scenario.map, cell, scenario.rules).sort(
      (left, right) => cellIndex(scenario.map, left) - cellIndex(scenario.map, right),
    );
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

function validateScenario(
  scenario: Scenario,
): { readonly code: "invalid-scenario" | "unsupported-rules"; readonly message: string } | null {
  if (scenario.kind !== "one-shot-mapf") {
    return { code: "unsupported-rules", message: "ICTS は one-shot MAPF のみに対応します。" };
  }
  if (scenario.rules.allowDiagonal) {
    return {
      code: "unsupported-rules",
      message: "ICTS は 4 近傍かつ following conflict を許す原論文モデルだけに対応します。",
    };
  }
  if (scenario.rules.goalBehavior !== "stay") {
    return { code: "unsupported-rules", message: "ICTS は stay-at-goal モデルだけに対応します。" };
  }
  if (scenario.agents.length === 0) {
    return { code: "invalid-scenario", message: "エージェントが 1 体もありません。" };
  }
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

function resolveMaxIndividualCost(
  scenario: Scenario,
  options: SolverOptions,
): { readonly value: number } | { readonly error: string } {
  const raw = options.extra?.maxIndividualCost ?? options.horizon;
  const fallback = Math.min(options.maxHorizon, defaultMaxTime(scenario));
  if (raw === undefined) return { value: fallback };
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > options.maxHorizon) {
    return { error: `maxIndividualCost は 1..${options.maxHorizon} の整数で指定してください。` };
  }
  return { value: raw };
}

function resolvePairwisePruning(
  options: SolverOptions,
): { readonly value: boolean } | { readonly error: string } {
  const raw = options.extra?.pairwisePruning;
  if (raw === undefined) return { value: true };
  if (typeof raw !== "boolean") return { error: "pairwisePruning は boolean で指定してください。" };
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
