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
} from "@/lib/model/types.js";
import {
  cellEquals,
  cellIndex,
  cellKey,
  indexToCell,
  isWalkable,
  neighbors,
} from "@/lib/model/grid.js";
import { createTraceRecorder } from "../context.js";
import { checkLimits } from "../limits.js";
import { buildResult, checkAbort } from "../shared.js";
import { PushEngine, type EngineStop } from "./engine.js";
import { decomposeAndOrder } from "./decomposition.js";

type Variant = "push-and-swap" | "push-and-rotate";

export const pushAndSwapSolver: MapfSolver = {
  metadata: {
    id: "push-and-swap",
    displayName: "Push and Swap",
    originalName: "Push and Swap",
    category: "push",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: ["allowDiagonal", "forbidFollowing", "goalBehavior"],
    basedOnPaperIds: ["push-and-swap-ijcai-2011", "push-and-rotate-aamas-2013"],
    implementationNote:
      "IJCAI 2011 Algorithms 1–3 の push / multipush / exchange / reverse と、後続一次資料の corrected 4-stage clear を独立実装。後続論文が示した反例のため、失敗は一般の解なし証明として扱わない。solution smoothing は未対応。",
  },
  async solve(scenario, options, context): Promise<SolverResult> {
    return solvePushVariant("push-and-swap", scenario, options, context);
  },
};

export const pushAndRotateSolver: MapfSolver = {
  metadata: {
    id: "push-and-rotate",
    displayName: "Push and Rotate",
    originalName: "Push and Rotate",
    category: "push",
    supports: ["one-shot-mapf"],
    status: "runnable",
    /*
      ★ paper-faithful から下げた。

        原論文 Theorem 1 は「各連結成分に空き頂点が 2 個以上」で完全と示すが、
        この実装はそのクラスを取りこぼす。4×2 の空きグリッド・空き頂点 2 個で、
        LaCAM が解ける配置を no-solution と返す例が出ている（該当クラスは
        biconnected なので Kornhauser の結果より常に可解）。swap の多段 clear を
        論文どおりに再現できていないことが原因で、rotate までは到達していない。
    */
    fidelity: "educational",
    unsupportedRules: ["allowDiagonal", "forbidFollowing", "goalBehavior"],
    basedOnPaperIds: ["push-and-rotate-aamas-2013"],
    implementationNote:
      "AAMAS 2013 Algorithms 1–4 と著者 thesis Algorithms 4.1.1–4.2.11 を基に、biconnected subproblem merge、agent assignment、priority propagation、plan / push / swap / rotate / resolve、4-stage clear を独立実装。4 近傍 unit-cost grid に限定し、solution smoothing と一般 graph import は含まない。★ swap の多段 clear が論文どおりでないため、原論文 Theorem 1 のクラス（各連結成分に空き頂点 2 個以上）でも失敗することがある。完全性は主張しない。",
  },
  async solve(scenario, options, context): Promise<SolverResult> {
    return solvePushVariant("push-and-rotate", scenario, options, context);
  },
};

async function solvePushVariant(
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
  let stopState: EngineStop = null;

  if (!limits.ok) return finish(limits.result!);
  const validation = validateScenario(scenario);
  if (validation) return finish(errorResult(validation.code, validation.message));
  const agents = scenario.agents as readonly (AgentSpec & { readonly goal: Cell })[];
  const components = findComponents(scenario);
  for (const agent of agents) {
    const startComponent = components.labels[cellIndex(scenario.map, agent.start)];
    const goalComponent = components.labels[cellIndex(scenario.map, agent.goal)];
    if (startComponent !== goalComponent) {
      return finish(failureResult("no-solution", "unreachable-goal"));
    }
  }
  const activeComponents = new Set(
    agents.map((agent) => components.labels[cellIndex(scenario.map, agent.start)]!),
  );
  for (const component of activeComponents) {
    const cells = components.cells[component] ?? [];
    const agentCount = agents.filter(
      (agent) => components.labels[cellIndex(scenario.map, agent.start)] === component,
    ).length;
    if (agentCount > 1 && cells.length - agentCount < 2) {
      return finish(
        errorResult(
          "unsupported-rules",
          `${variant === "push-and-swap" ? "Push and Swap" : "Push and Rotate"} は各対象 connected component に空き vertex が 2 個以上必要です。`,
        ),
      );
    }
  }

  const maxMovesResult = resolveMaxMoves(scenario, options);
  if ("error" in maxMovesResult)
    return finish(errorResult("invalid-scenario", maxMovesResult.error));
  const engine = new PushEngine({
    map: scenario.map,
    agents,
    maxMoves: maxMovesResult.value,
    consumeExpansion,
    emit,
  });
  let order: readonly number[];
  if (variant === "push-and-rotate") {
    if (options.extra?.agentOrder !== undefined) {
      return finish(
        errorResult(
          "invalid-scenario",
          "Push and Rotate の agent order は Algorithms 1–4 の subproblem priority から決めるため、agentOrder では上書きできません。",
        ),
      );
    }
    const decomposition = decomposeAndOrder(
      scenario.map,
      agents,
      context.random,
      () => consumeExpansion() !== null,
    );
    if (decomposition.stopped) {
      return finish(failureResult(stopState ?? "node-limit", "limit-exceeded"));
    }
    /*
      ★ 優先度関係に閉路があっても「解なし」にしない。

        原論文 Algorithm 4 は毎回「最高優先度の未完了 agent」を選ぶ方式で、
        事前の全順序を要求しない。解が無いと判定してよいのは Theorem 1 の
        条件（swap の失敗）だけである。

        以前はここで警告も無しに no-solution / search-exhausted を返しており、
        空き頂点がちょうど 2 個の密な盤面では、LaCAM が解ける入力の 6 割で
        「解が見つかりませんでした」と表示していた。
    */
    if (decomposition.brokeCycle) {
      warnings.push({
        code: "simplified-behavior",
        message:
          "subproblem の優先度関係に閉路があったため、順序を決める際に 1 本切りました。" +
          "原論文の優先順位から外れるので、失敗した場合でも解の非存在の証明にはなりません。",
      });
    }
    order = decomposition.order;
    for (const subproblem of decomposition.subproblems) {
      emit({
        type: "create-subproblem",
        subproblemId: subproblem.id,
        cells: subproblem.cells.map((index) => indexToCell(scenario.map, index)),
        agentIds: subproblem.agentIndices.map((index) => agents[index]!.id),
      });
    }
    for (const edge of decomposition.priorityEdges) {
      for (const higher of decomposition.subproblems[edge.higher]?.agentIndices ?? []) {
        for (const lower of decomposition.subproblems[edge.lower]?.agentIndices ?? []) {
          emit({ type: "set-priority", higher: agents[higher]!.id, lower: agents[lower]!.id });
        }
      }
    }
  } else {
    const orderResult = resolveOrder(agents, options);
    if ("error" in orderResult) return finish(errorResult("invalid-scenario", orderResult.error));
    order = orderResult.value;
  }
  emit({ type: "priority-order", time: 0, order: order.map((index) => agents[index]!.id) });

  if (variant === "push-and-rotate") {
    const finished = new Set<number>();
    for (const agentIndex of order) {
      const ok = isPolygonComponent(engine.positions[agentIndex]!)
        ? planPolygon(agentIndex, finished)
        : planRotate(agentIndex, finished, [], 0);
      if (!ok) return failedPlan();
      emit({
        type: "progress",
        ratio: finished.size / agents.length,
        label: `${agents[agentIndex]!.id} を goal へ配置`,
      });
    }
    // Algorithm 4.2.11 の再帰 resolve が残した trail 外の resolving agent も固定点まで戻す。
    // swap の準備経路が planning trail と交差しない場合に必要になる。
    for (let pass = 0; pass < agents.length * 2; pass += 1) {
      const displaced = agents.findIndex(
        (agent, index) =>
          finished.has(index) && engine.positions[index] !== cellIndex(scenario.map, agent.goal),
      );
      if (displaced < 0) break;
      if (!planRotate(displaced, finished, [], 0)) return failedPlan();
    }
    return solvedPlan();
  }

  const locked = new Set<number>();

  for (const agentIndex of order) {
    if (!planAgent(agentIndex)) {
      if (engine.stop) {
        warnings.push({
          code: "input-too-large",
          message: `Push 系 solver は安全上限で打ち切りました。解の非存在を証明した結果ではありません。`,
        });
        return finish(failureResult(engine.stop, "limit-exceeded"));
      }
      warnings.push({
        code: "simplified-behavior",
        message:
          `${variant === "push-and-swap" ? "Push and Swap" : "Push and Rotate"} の primitive で計画を継続できませんでした。` +
          "これは一般の MAPF 解が存在しないことの証明ではありません。",
      });
      return finish(failureResult("no-solution", "search-exhausted"));
    }
    locked.add(cellIndex(scenario.map, agents[agentIndex]!.goal));
    emit({
      type: "progress",
      ratio: locked.size / agents.length,
      label: `${agents[agentIndex]!.id} を goal へ配置`,
    });
  }

  return solvedPlan();

  function planAgent(agentIndex: number): boolean {
    const goal = cellIndex(scenario.map, agents[agentIndex]!.goal);
    let iterations = 0;
    const iterationLimit = scenario.map.width * scenario.map.height * 8;
    while (engine.positions[agentIndex] !== goal && iterations < iterationLimit) {
      iterations += 1;
      const path = engine.shortestPath(engine.positions[agentIndex]!, goal, locked);
      if (!path || path.length < 2) return false;
      const next = path[1]!;
      const blocker = engine.occupancy[next]!;
      if (blocker >= 0 && blocker !== agentIndex) {
        const forbidden = new Set<number>([...locked, engine.positions[agentIndex]!]);
        if (locked.has(next) || !engine.clearVertex(next, forbidden, "clear")) {
          if (!engine.swapAgents(agentIndex, blocker)) return false;
          generated += 1;
          continue;
        }
      }
      if (!engine.move(agentIndex, next, "plan")) return false;
      generated += 1;
    }
    return engine.positions[agentIndex] === goal;
  }

  function planRotate(
    agentIndex: number,
    finished: Set<number>,
    trail: number[],
    recursionDepth: number,
  ): boolean {
    if (recursionDepth > agents.length * 2) return false;
    // q は planning agent が通った path。最初の swap で後退した finished agent も
    // resolve が見つけられるよう、path の始点を含める。
    if (trail.length === 0) trail.push(engine.positions[agentIndex]!);
    const goal = cellIndex(scenario.map, agents[agentIndex]!.goal);
    let iterations = 0;
    const iterationLimit = scenario.map.width * scenario.map.height * 16;
    while (engine.positions[agentIndex] !== goal && iterations < iterationLimit) {
      iterations += 1;
      const path = engine.shortestPath(engine.positions[agentIndex]!, goal);
      if (!path || path.length < 2) return false;
      const next = path[1]!;
      const cycleStart = trail.indexOf(next);
      if (cycleStart >= 0) {
        const cycle = trail.slice(cycleStart);
        if (cycle.length < 3 || !engine.rotateCycle(cycle)) return false;
        trail.splice(cycleStart);
      } else if (!pushOne(agentIndex, next, finished)) {
        const blocker = engine.occupancy[next]!;
        if (blocker < 0 || !engine.swapAgents(agentIndex, blocker)) return false;
        generated += 1;
      }
      trail.push(next);
    }
    if (engine.positions[agentIndex] !== goal) return false;
    finished.add(agentIndex);
    return resolveTrail(finished, trail, recursionDepth);
  }

  function planPolygon(agentIndex: number, finished: Set<number>): boolean {
    const goal = cellIndex(scenario.map, agents[agentIndex]!.goal);
    const protectedVertices = new Set([...finished].map((index) => engine.positions[index]!));
    const path = engine.shortestPath(engine.positions[agentIndex]!, goal, protectedVertices);
    if (!path) return false;
    for (let offset = 1; offset < path.length; offset += 1) {
      if (!pushOne(agentIndex, path[offset]!, finished)) return false;
    }
    finished.add(agentIndex);
    return true;
  }

  function pushOne(agentIndex: number, target: number, finished: ReadonlySet<number>): boolean {
    const protectedVertices = new Set([...finished].map((index) => engine.positions[index]!));
    const current = engine.positions[agentIndex]!;
    const occupant = engine.occupancy[target]!;
    if (occupant >= 0) {
      if (protectedVertices.has(target)) return false;
      if (!engine.clearVertex(target, new Set([...protectedVertices, current]), "clear"))
        return false;
    }
    if (!engine.move(agentIndex, target, "plan")) return false;
    generated += 1;
    return true;
  }

  function resolveTrail(finished: Set<number>, trail: number[], recursionDepth: number): boolean {
    while (trail.length > 0) {
      const vertex = trail[trail.length - 1]!;
      const occupant = engine.occupancy[vertex]!;
      if (occupant >= 0 && finished.has(occupant)) {
        const goal = cellIndex(scenario.map, agents[occupant]!.goal);
        if (engine.positions[occupant] !== goal && !pushOne(occupant, goal, finished)) {
          const blocking = engine.occupancy[goal]!;
          if (blocking < 0 || !planRotate(blocking, finished, trail, recursionDepth + 1)) {
            return false;
          }
        }
      }
      trail.pop();
    }
    return true;
  }

  function isPolygonComponent(vertex: number): boolean {
    const component = components.labels[vertex]!;
    const cells = components.cells[component] ?? [];
    return (
      cells.length >= 3 &&
      cells.every((cell) => neighbors(scenario.map, indexToCell(scenario.map, cell)).length === 2)
    );
  }

  function failedPlan(): SolverResult {
    if (engine.stop) {
      warnings.push({
        code: "input-too-large",
        message:
          "Push 系 solver は安全上限で打ち切りました。解の非存在を証明した結果ではありません。",
      });
      return finish(failureResult(engine.stop, "limit-exceeded"));
    }
    /*
      ★ どちらの variant でも「解が無い」とは言えない。

        原論文 Theorem 1 は「各連結成分に空き頂点が 2 個以上」のクラスで
        Push and Rotate の完全性を示す。しかしこのブラウザ実装はそのクラスを
        取りこぼす。4×2 の空きグリッド・空き頂点 2 個（biconnected なので
        Kornhauser の結果より常に可解）で、LaCAM が解ける配置を
        no-solution と返す例が出ている。原因は swap の多段 clear を
        論文どおりに実装しきれていないことで、rotate までは到達していない。

        以前は push-and-swap のときだけ但し書きを付け、push-and-rotate では
        「対象クラスなら必ず解ける」前提で無言の no-solution を返していた。
        実装が前提を満たしていないので、これは過大主張だった。
    */
    warnings.push(
      variant === "push-and-swap"
        ? {
            code: "simplified-behavior",
            message:
              "Push and Swap の primitive で計画を継続できませんでした。後続一次資料が反例を示しているため、一般の MAPF 解が存在しないことの証明ではありません。",
          }
        : {
            code: "simplified-behavior",
            message:
              "Push and Rotate の primitive で計画を継続できませんでした。原論文 Theorem 1 は空き頂点 2 個以上のクラスでの完全性を示しますが、この実装は swap の多段 clear を再現しきれておらず、そのクラス内でも失敗することがあります。解が存在しないことの証明ではありません。",
          },
    );
    return finish(failureResult("no-solution", "search-exhausted"));
  }

  function solvedPlan(): SolverResult {
    if (
      !agents.every((agent, index) =>
        cellEquals(indexToCell(scenario.map, engine.positions[index]!), agent.goal),
      )
    ) {
      return finish(
        internalError(
          `Push 系 solver の終了時 configuration が goal assignment と一致しません。positions=${engine.positions.join(",")} goals=${agents.map((agent) => cellIndex(scenario.map, agent.goal)).join(",")}`,
        ),
      );
    }
    const paths = engine.toPaths();
    const base = buildResult(scenario, paths, context.now() - startedAt, expanded, "solved", {
      generatedNodes: generated,
    });
    if (base.conflicts.length > 0)
      return finish(internalError("逐次 push plan に conflict が残りました。"));
    return finish(base);
  }

  function consumeExpansion(): EngineStop {
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
    return null;
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
    return {
      code: "unsupported-rules",
      message: "Push 系 solver は one-shot MAPF のみに対応します。",
    };
  }
  if (scenario.rules.allowDiagonal) {
    return { code: "unsupported-rules", message: "Push 系 solver は 4 近傍 grid に対応します。" };
  }
  /*
    ★ PIBT と同じ理由。push 操作は「押した相手のセルへ入る」ことそのもの。
  */
  if (scenario.rules.forbidFollowing) {
    return {
      code: "unsupported-rules",
      message:
        "Push 系 solver の push 操作は「押した相手が空けたセルへ入る」ことそのもので、following conflict にあたります。禁止するとこの手法の中核が成り立たないため対応しません。",
    };
  }
  if (scenario.rules.goalBehavior !== "stay") {
    return {
      code: "unsupported-rules",
      message: "Push 系 solver は stay-at-goal のみに対応します。",
    };
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

function resolveMaxMoves(
  scenario: Scenario,
  options: SolverOptions,
): { readonly value: number } | { readonly error: string } {
  const raw = options.extra?.maxMoves ?? options.horizon;
  const fallback = Math.min(
    options.maxHorizon,
    Math.max(
      64,
      scenario.map.width * scenario.map.height * Math.max(1, scenario.agents.length) * 2,
    ),
  );
  if (raw === undefined) return { value: fallback };
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > options.maxHorizon) {
    return { error: `maxMoves は 1..${options.maxHorizon} の整数で指定してください。` };
  }
  return { value: raw };
}

function resolveOrder(
  agents: readonly (AgentSpec & { readonly goal: Cell })[],
  options: SolverOptions,
): { readonly value: number[] } | { readonly error: string } {
  const raw = options.extra?.agentOrder;
  if (raw !== undefined) {
    if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string")) {
      return { error: "agentOrder は agent ID の配列で指定してください。" };
    }
    const ids = raw as string[];
    if (ids.length !== agents.length || new Set(ids).size !== agents.length) {
      return { error: "agentOrder には全 agent ID を重複なく 1 回ずつ指定してください。" };
    }
    const byId = new Map(agents.map((agent, index) => [agent.id, index]));
    const result = ids.map((id) => byId.get(id));
    if (result.some((index) => index === undefined))
      return { error: "agentOrder に未知の agent ID があります。" };
    return { value: result as number[] };
  }
  return { value: agents.map((_, index) => index) };
}

function findComponents(scenario: Scenario): {
  readonly labels: Int32Array;
  readonly cells: number[][];
} {
  const size = scenario.map.width * scenario.map.height;
  const labels = new Int32Array(size).fill(-1);
  const cells: number[][] = [];
  for (let start = 0; start < size; start += 1) {
    if (labels[start] !== -1 || !isWalkable(scenario.map, indexToCell(scenario.map, start)))
      continue;
    const component = cells.length;
    const list: number[] = [];
    const queue = [start];
    labels[start] = component;
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head]!;
      list.push(current);
      for (const next of neighbors(scenario.map, indexToCell(scenario.map, current))) {
        const index = cellIndex(scenario.map, next);
        if (labels[index] !== -1) continue;
        labels[index] = component;
        queue.push(index);
      }
    }
    cells.push(list);
  }
  return { labels, cells };
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
