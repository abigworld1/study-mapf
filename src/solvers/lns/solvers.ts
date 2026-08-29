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
import { detectConflicts, makespanOf, sumOfCosts, positionAt } from "@/lib/model/conflicts.js";
import {
  cellEquals,
  cellIndex,
  isWalkable,
  lookupDistance,
  neighbors,
  trueDistanceFrom,
} from "@/lib/model/grid.js";
import { SimpleReservationTable, reservePathForRules } from "@/lib/model/reservation.js";
import { createTraceRecorder } from "../context.js";
import { checkLimits } from "../limits.js";
import { buildResult, checkAbort, defaultMaxTime } from "../shared.js";
import { spaceTimeAStar, type LowLevelStopReason } from "../low-level/space-time-astar.js";

type StopState = "timeout" | "aborted" | "node-limit" | "max-expansions" | null;
type LnsStrategy = "agent" | "map" | "random";
const ALNS_REACTION_FACTOR = 0.01;

/** 打ち切り理由を利用者向けの語にする。outcome とは別物。 */
const LNS_STOP_LABEL: Partial<Record<SolverOutcome, string>> = {
  timeout: "実行時間の上限",
  aborted: "利用者の中断",
  "node-limit": "展開数の上限",
};

interface RhcrGoal {
  readonly cell: Cell;
  readonly releaseTime: number;
}

interface SearchCounters {
  expanded: number;
  generated: number;
  replans: number;
  conflictsDetected: number;
  stop: StopState;
}

interface CommonRun {
  readonly startedAt: number;
  readonly recorder: ReturnType<typeof createTraceRecorder>;
  readonly warnings: SolverWarning[];
  readonly counters: SearchCounters;
  readonly emit: (event: SolverEvent) => void;
  readonly options: SolverOptions;
  readonly context: SolverContext;
}

interface PlanOutput {
  readonly path: TimedPath | null;
  readonly reason?: "no-path" | "max-time" | LowLevelStopReason;
  readonly generated: number;
}

const LNS_UNSUPPORTED = ["allowDiagonal", "forbidFollowing", "goalBehavior"] as const;

export const mapfLnsSolver: MapfSolver = {
  metadata: {
    id: "mapf-lns",
    displayName: "MAPF-LNS",
    originalName: "Anytime MAPF via Large Neighborhood Search",
    category: "lns",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: LNS_UNSUPPORTED,
    basedOnPaperIds: ["mapf-lns-ijcai-2021"],
    implementationNote:
      "IJCAI 2021 §4–5 の initial solution → destroy → repair → accept-if-better 骨格と agent/map/random neighborhood を実装。EECBS、SIPP、論文の全 ALNS 細部は既存の deterministic Space-Time A* に簡略化している。",
  },
  async solve(scenario, options, context): Promise<SolverResult> {
    return solveMapfLns(scenario, options, context);
  },
};

export const mapfLns2Solver: MapfSolver = {
  metadata: {
    id: "mapf-lns2",
    displayName: "MAPF-LNS2",
    originalName: "MAPF-LNS2",
    category: "lns",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: LNS_UNSUPPORTED,
    basedOnPaperIds: ["mapf-lns2-aaai-2022"],
    implementationNote:
      "AAAI 2022 §3–5 の衝突を含む初期 plan、collision-pair / failure / random neighborhood、CP 非増加修復を実装。SIPPS の完全な soft-interval dominance は既存 Space-Time A* と明示的 soft 評価へ簡略化している。",
  },
  async solve(scenario, options, context): Promise<SolverResult> {
    return solveMapfLns2(scenario, options, context);
  },
};

export const rhcrSolver: MapfSolver = {
  metadata: {
    id: "rhcr",
    displayName: "RHCR",
    originalName: "Rolling-Horizon Collision Resolution",
    category: "lifelong",
    supports: ["one-shot-mapf", "lifelong-mapf"],
    status: "runnable",
    fidelity: "educational",
    unsupportedRules: LNS_UNSUPPORTED,
    basedOnPaperIds: ["rhcr-aaai-2021"],
    implementationNote:
      "AAAI 2021 §4 の w-step planning / h-step execution を教材用に実装。one-shot の固定 goal も一要素の queue として実行できる。warehouse 固有 task assigner、Multi-Label A*、Poisson arrivals、windowed ECBS/PBS/CBS の全変種は未対応。",
  },
  async solve(scenario, options, context): Promise<SolverResult> {
    return solveRhcr(scenario, options, context);
  },
};

async function solveMapfLns(
  scenario: Scenario,
  options: SolverOptions,
  context: SolverContext,
): Promise<SolverResult> {
  const run = createRunWithScenario(scenario, options, context);
  const validation = validateOneShot(scenario);
  if (!run.limits.ok) return finishLns(run, run.limits.result!);
  if (validation) return finishLns(run, errorResult(run, validation.message, validation.code));

  const agents = scenario.agents as readonly (AgentSpec & { readonly goal: Cell })[];
  const maxTime = resolveMaxTime(scenario, options, run.warnings, "MAPF-LNS");
  const ranks = deterministicRanks(agents.length, context);
  const distances = agents.map((agent) => trueDistanceFrom(scenario.map, agent.goal));
  const lowerBound = sumDistances(scenario, agents, distances);
  if (!Number.isFinite(lowerBound)) {
    addIncompleteWarning(run, "MAPF-LNS", "初期計画に失敗しました。");
    return finishLns(run, failureResult(run, "no-solution", "unreachable-goal"));
  }

  const initial = await planAll(
    scenario,
    agents,
    agents.map((_, index) => index),
    new Map(),
    maxTime,
    run,
  );
  if (!initial.complete) {
    addIncompleteWarning(run, "MAPF-LNS", "優先順位付きの初期計画に失敗しました。");
    return finishLns(run, initial.failure ?? failureResult(run, "no-solution", "priority-order"));
  }

  let incumbent = initial.paths;
  let incumbentCost = sumOfCosts(incumbent);
  const tabu = new Set<number>();
  const weights: Record<LnsStrategy, number> = { agent: 1, map: 1, random: 1 };
  const neighborhoodSize = readPositiveInt(
    options.extra?.neighborhoodSize,
    Math.min(4, agents.length),
  );
  const maxIterations = readPositiveInt(options.extra?.iterations, 1000);
  const requestedStrategy = readStrategy(options.extra?.destroyStrategy);
  let outcome: SolverOutcome = "solved";

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const stop = checkRunStop(run, options, context);
    if (stop) {
      outcome = stop;
      break;
    }
    const strategy = requestedStrategy ?? weightedStrategy(weights, context.random());
    const selected = selectLnsNeighborhood(
      scenario,
      agents,
      incumbent,
      neighborhoodSize,
      strategy,
      tabu,
      context.random,
    );
    run.emit({
      type: "select-neighborhood",
      agentIds: selected.map((index) => agents[index]!.id),
      strategy,
    });
    if (selected.length === 0) break;
    run.emit({
      type: "destroy-neighborhood",
      agentIds: selected.map((index) => agents[index]!.id),
    });

    const repaired = await repairPaths(scenario, agents, incumbent, selected, maxTime, run, ranks);
    run.emit({
      type: "repair-neighborhood",
      agentIds: selected.map((index) => agents[index]!.id),
    });
    if (repaired.paths) {
      const candidateCost = sumOfCosts(repaired.paths);
      const improvement = incumbentCost - candidateCost;
      if (candidateCost < incumbentCost && repaired.conflicts.length === 0) {
        incumbent = repaired.paths;
        incumbentCost = candidateCost;
        weights[strategy] =
          ALNS_REACTION_FACTOR * Math.max(0, improvement) +
          (1 - ALNS_REACTION_FACTOR) * weights[strategy];
        run.emit({ type: "accept-solution", cost: incumbentCost, iteration });
        run.emit({ type: "update-incumbent", cost: incumbentCost, iteration });
      } else {
        weights[strategy] *= 0.99;
        run.emit({ type: "reject-solution", cost: candidateCost, iteration });
      }
    } else {
      weights[strategy] *= 0.99;
      run.emit({ type: "reject-solution", cost: incumbentCost, iteration });
    }
    run.emit({
      type: "progress",
      ratio: Math.min(1, (iteration + 1) / maxIterations),
      label: `MAPF-LNS iteration ${iteration + 1}`,
    });
  }

  /*
    ★ ここまで来ていれば incumbent は全 agent が goal に着く衝突ゼロの解である。
      初期計画は complete を確認済みで、改善は conflicts.length === 0 の
      候補しか受け入れない。改善ループを打ち切っただけなので outcome は
      solved であり、node-limit や timeout を返してはいけない。

      以前は打ち切り理由をそのまま outcome にしていたため、有効な解を
      返しながら画面に「時間切れ」「上限到達」と出していた。
      LaCAM* と同じ誤報である。
  */
  if (outcome !== "solved") {
    run.warnings.push({
      code: "simplified-behavior",
      message:
        `${LNS_STOP_LABEL[outcome] ?? "上限"}で改善を打ち切りました。` +
        "解は見つかっていますが、MAPF-LNS は anytime 手法なので、続ければさらに改善する余地があります。",
    });
  }

  return finishLns(run, resultFromPaths(scenario, incumbent, run, "solved", undefined));
}

async function solveMapfLns2(
  scenario: Scenario,
  options: SolverOptions,
  context: SolverContext,
): Promise<SolverResult> {
  const run = createRunWithScenario(scenario, options, context);
  const validation = validateOneShot(scenario);
  if (!run.limits.ok) return finishLns(run, run.limits.result!);
  if (validation) return finishLns(run, errorResult(run, validation.message, validation.code));

  const agents = scenario.agents as readonly (AgentSpec & { readonly goal: Cell })[];
  const maxTime = resolveMaxTime(scenario, options, run.warnings, "MAPF-LNS2");
  const ranks = deterministicRanks(agents.length, context);
  const distances = agents.map((agent) => trueDistanceFrom(scenario.map, agent.goal));
  if (!Number.isFinite(sumDistances(scenario, agents, distances))) {
    addIncompleteWarning(run, "MAPF-LNS2", "初期計画に失敗しました。");
    return finishLns(run, failureResult(run, "no-solution", "unreachable-goal"));
  }

  // MAPF-LNS2 deliberately starts with individual paths, which may collide.
  const initial = await planAll(
    scenario,
    agents,
    agents.map((_, index) => index),
    new Map(),
    maxTime,
    run,
    false,
  );
  if (!initial.paths.length) {
    addIncompleteWarning(run, "MAPF-LNS2", "初期の個別計画に失敗しました。");
    return finishLns(run, initial.failure ?? failureResult(run, "no-solution", "unreachable-goal"));
  }
  let incumbent = initial.paths;
  let incumbentPairs = countCollisionPairs(incumbent, scenario);
  let incumbentCost = sumOfCosts(incumbent);
  if (incumbentPairs === 0) {
    return finishLns(run, resultFromPaths(scenario, incumbent, run, "solved", undefined));
  }

  const neighborhoodSize = readPositiveInt(
    options.extra?.neighborhoodSize,
    Math.min(8, agents.length),
  );
  const maxIterations = readPositiveInt(options.extra?.iterations, 2000);
  const requestedStrategy = readLns2Strategy(options.extra?.neighborhoodStrategy);
  const weights: Record<LnsStrategy, number> = { agent: 1, map: 1, random: 1 };
  let outcome: SolverOutcome = "no-solution";

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const stop = checkRunStop(run, options, context);
    if (stop) {
      outcome = stop;
      break;
    }
    const strategy = requestedStrategy ?? weightedStrategy(weights, context.random());
    const selected = selectLns2Neighborhood(
      scenario,
      agents,
      incumbent,
      neighborhoodSize,
      strategy,
      context.random,
    );
    run.emit({
      type: "select-neighborhood",
      agentIds: selected.map((index) => agents[index]!.id),
      strategy: `MAPF-LNS2 ${strategy}`,
    });
    if (selected.length === 0) break;
    run.emit({
      type: "destroy-neighborhood",
      agentIds: selected.map((index) => agents[index]!.id),
    });
    const repaired = await repairPaths(scenario, agents, incumbent, selected, maxTime, run, ranks);
    run.emit({ type: "repair-neighborhood", agentIds: selected.map((index) => agents[index]!.id) });
    if (repaired.paths) {
      const candidatePairs = countCollisionPairs(repaired.paths, scenario);
      const candidateCost = sumOfCosts(repaired.paths);
      run.counters.conflictsDetected += repaired.conflicts.length;
      const pairImprovement = incumbentPairs - candidatePairs;
      if (
        pairImprovement > 0 ||
        (candidatePairs === incumbentPairs && candidateCost < incumbentCost)
      ) {
        incumbent = repaired.paths;
        incumbentPairs = candidatePairs;
        incumbentCost = candidateCost;
        weights[strategy] =
          ALNS_REACTION_FACTOR * Math.max(0, pairImprovement) +
          (1 - ALNS_REACTION_FACTOR) * weights[strategy];
        run.emit({ type: "accept-solution", cost: candidatePairs, iteration });
        run.emit({ type: "update-incumbent", cost: candidatePairs, iteration });
      } else {
        run.emit({ type: "reject-solution", cost: candidatePairs, iteration });
      }
    } else {
      run.emit({ type: "reject-solution", cost: incumbentPairs, iteration });
    }
    run.emit({
      type: "progress",
      ratio: Math.min(1, (iteration + 1) / maxIterations),
      label: `MAPF-LNS2 repair ${iteration + 1}（CP=${incumbentPairs}）`,
    });
    if (incumbentPairs === 0) {
      outcome = "solved";
      break;
    }
  }

  const failure =
    outcome === "solved"
      ? undefined
      : outcome === "no-solution"
        ? "search-exhausted"
        : "limit-exceeded";
  if (outcome !== "solved") {
    addIncompleteWarning(run, "MAPF-LNS2", "collision pair の修復を完遂できませんでした。");
  }
  return finishLns(run, resultFromPaths(scenario, incumbent, run, outcome, failure));
}

async function solveRhcr(
  scenario: Scenario,
  options: SolverOptions,
  context: SolverContext,
): Promise<SolverResult> {
  const run = createRunWithScenario(scenario, options, context);
  if (!run.limits.ok) return finishLns(run, run.limits.result!);
  const oneShotScenario = scenario.kind === "one-shot-mapf";
  if (!oneShotScenario && scenario.kind !== "lifelong-mapf") {
    return finishLns(
      run,
      errorResult(
        run,
        "RHCR は one-shot MAPF または lifelong MAPF の Scenario に対応します。",
        "unsupported-rules",
      ),
    );
  }
  const validation = validateCommonScenario(scenario, oneShotScenario);
  if (validation) return finishLns(run, errorResult(run, validation.message, validation.code));
  if (oneShotScenario) {
    run.warnings.push({
      code: "simplified-behavior",
      message:
        "one-shot Scenario を一要素の goal queue として RHCR に入力しています。オンライン到着は再現しません。",
    });
  }
  const rawW = options.extra?.planningWindow ?? options.extra?.windowSize ?? 8;
  const rawH = options.extra?.replanningPeriod ?? options.extra?.simulationWindow ?? 2;
  if (!isPositiveInteger(rawW) || !isPositiveInteger(rawH) || rawW < rawH) {
    return finishLns(
      run,
      errorResult(
        run,
        "RHCR は planningWindow >= replanningPeriod >= 1 を要求します。",
        "invalid-scenario",
      ),
    );
  }
  const planningWindow = Math.min(rawW, options.maxHorizon);
  const replanningPeriod = rawH;
  /*
    シミュレーションを何 step 回すか。

    ★ w から導いてはいけない。w は「衝突を解消する先読みの長さ」であって、
      lifelong の運転時間とは無関係な量である（原論文 §4、p.3）。
      以前は w * 4 を既定にしていたため、既定 w=8 だと horizon=32 step しか
      回らず、warehouse プリセットが RHCR のせいではなく単に時間切れで
      pending=1 になっていた（horizon=200 なら solved）。
      しかも UI から変えられるのは w だけなので、無関係なつまみを回して
      回避するしかない状態だった。マップと goal 距離から決める。
  */
  const horizon = Math.min(
    options.horizon ?? Math.max(planningWindow, defaultMaxTime(scenario)),
    options.maxHorizon,
  );
  const agents = scenario.agents;
  const ranks = deterministicRanks(agents.length, context);
  const goalQueues = buildGoalQueues(scenario, agents);
  const histories = agents.map((agent) => ({
    agentId: agent.id,
    positions: [{ time: 0, cell: agent.start }],
  }));
  let current = agents.map((agent) => ({ ...agent.start }));
  let currentTime = 0;
  const serviceTimes: number[] = [];
  let outcome: SolverOutcome = "solved";
  let pending = goalQueues.reduce((total, queue) => total + queue.length, 0);
  const totalGoals = pending;
  let completedGoals = 0;

  while (currentTime < horizon && pending > 0) {
    const stop = checkRunStop(run, options, context);
    if (stop) {
      outcome = stop;
      break;
    }
    const episodeEnd = Math.min(horizon, currentTime + planningWindow);
    const table = new SimpleReservationTable();
    const episodePaths: TimedPath[] = [];
    let episodeFailure: SolverResult | undefined;
    /*
      ★ 動かないものを先に予約する。

        goal queue が空になった agent はその場から動けない。これを
        rank 順に混ぜて処理すると、先に計画した agent が「まだ予約されて
        いない停止中の agent」の上を通る経路を引いてしまう。
        ランダム 60 盤面の検証で、goal に着いて止まった agent の上を
        別の agent が通り抜ける衝突が実際に出ていた。

        本来の RHCR は lifelong なので「もう goal が無い agent」が
        存在せず、この順序問題は起きない。one-shot へ持ち込んだ
        こちら側の都合なので、こちら側で閉じる。
    */
    const order = agents.map((_, index) => index).sort((a, b) => ranks[a]! - ranks[b]! || a - b);
    const idle = order.filter((index) => !goalQueues[index]![0]);
    for (const index of idle) {
      const agent = agents[index]!;
      const waitPath = waitPathFor(agent.id, current[index]!, currentTime, episodeEnd);
      episodePaths.push(waitPath);
      reservePathForRules(table, waitPath, episodeEnd, scenario.rules);
    }
    for (const index of order) {
      const agent = agents[index]!;
      const target = goalQueues[index]![0];
      if (!target) continue;
      // RHCR の w は path 全体の長さではなく、衝突を解消する先読み範囲である。
      // したがって低レベル探索は goal まで続け、予約表だけを最初の w step に切る。
      const searchEnd = rhcrSearchEnd(scenario, currentTime, planningWindow, options.maxHorizon);
      run.counters.replans += 1;
      const plan = planAgent(
        scenario,
        agent.id,
        current[index]!,
        target.cell,
        table,
        currentTime,
        searchEnd,
        run,
      );
      if (!plan.path) {
        episodeFailure = failureResult(
          run,
          plan.reason === "max-time" ? "no-solution" : mapStop(plan.reason),
          "search-exhausted",
        );
        break;
      }
      episodePaths.push(plan.path);
      reservePathForRules(table, truncatePath(plan.path, episodeEnd), episodeEnd, scenario.rules);
    }
    if (episodeFailure) {
      outcome = episodeFailure.outcome;
      break;
    }

    const commit = Math.min(replanningPeriod, horizon - currentTime);
    const positionsById: Record<string, Cell> = {};
    for (let step = 1; step <= commit; step += 1) {
      const absoluteTime = currentTime + step;
      const next = agents.map((agent, index) => {
        const path = episodePaths.find((candidate) => candidate.agentId === agent.id);
        return path
          ? (positionAt(path, absoluteTime, scenario.rules) ?? current[index]!)
          : current[index]!;
      });
      current = next.map((cell) => ({ ...cell }));
      for (let index = 0; index < agents.length; index += 1) {
        histories[index]!.positions = [
          ...histories[index]!.positions,
          { time: absoluteTime, cell: current[index]! },
        ];
        positionsById[agents[index]!.id] = current[index]!;
      }
      run.emit({ type: "move", time: absoluteTime, positions: positionsById });
    }
    for (let index = 0; index < agents.length; index += 1) {
      const target = goalQueues[index]![0];
      const path = episodePaths.find((candidate) => candidate.agentId === agents[index]!.id);
      /*
        ★ 「到達した」の意味は問題設定で変わる。

          lifelong / MAPD では goal を通りがかった時点で用が済むので、
          窓の中で一度でもそのセルに居れば到達（firstArrivalTime）。

          one-shot MAPF は違う。解けたと言うには**最後にそこに留まって
          いる**必要がある。通過しただけで queue から外すと、
          その後の episode で agent は現在地に park してしまい、
          goal から離れた場所で止まったまま「解が求まりました」になる。
          実際 60 盤面のランダム検証で、goal 未到達のまま solved を返す例と
          衝突を残したまま solved を返す例が出ていた。
      */
      const arrivalTime =
        target && path
          ? oneShotScenario
            ? cellEquals(current[index]!, target.cell)
              ? currentTime + commit
              : undefined
            : firstArrivalTime(path, target.cell, currentTime, currentTime + commit, scenario.rules)
          : undefined;
      if (target && arrivalTime !== undefined) {
        goalQueues[index]!.shift();
        pending -= 1;
        completedGoals += 1;
        serviceTimes.push(Math.max(0, arrivalTime - target.releaseTime));
        run.emit({
          type: "progress",
          ratio: totalGoals === 0 ? 1 : completedGoals / totalGoals,
          label: `${agents[index]!.id} が goal に到達`,
        });
      }
    }
    currentTime += commit;
    run.emit({
      type: "replan",
      agentIds: agents.map((agent) => agent.id),
      reason: `RHCR episode t=${currentTime}`,
    });
    run.emit({
      type: "progress",
      ratio: Math.min(1, currentTime / Math.max(1, horizon)),
      label: `RHCR t=${currentTime}, w=${planningWindow}, h=${replanningPeriod}`,
    });
  }

  let horizonExhausted = false;
  if (pending > 0 && outcome === "solved") {
    outcome = "timeout";
    horizonExhausted = true;
    run.warnings.push({
      code: "simplified-behavior",
      message:
        `シミュレーション horizon=${horizon} step を使い切った時点で goal が ${pending} 件残りました。` +
        "これは実行時間の上限ではなく、運転時間の上限です。",
    });
  }
  /*
    ★ RHCR が goal を処理しきれなかったときは、必ず不完全性を明示する。
      原論文の結論（p.8）は completeness も optimality も保証しないと述べており、
      §4.4（p.6）は deadlock avoidance を入れても incomplete だと書いている。
      実例: swap-conflict プリセットは CBS が sum of costs 11 で解くが、
      RHCR の windowed 優先順位付き計画は w や horizon をどう変えても失敗する。
      これを「解が求まりませんでした」だけで見せると過大主張になる
      （SOURCE_POLICY.md 第 8 条）。MAPF-LNS / MAPF-LNS2 と同じ扱いにする。
  */
  if (outcome !== "solved") {
    addIncompleteWarning(
      run,
      "RHCR",
      rhcrFailureDetail(outcome, horizonExhausted),
      "完全性を保証しない枠組み",
    );
  }
  return finishLns(run, rhcrResult(scenario, histories, run, outcome, serviceTimes, pending));
}

function createRunWithScenario(
  scenario: Scenario,
  options: SolverOptions,
  context: SolverContext,
): CommonRun & { readonly limits: ReturnType<typeof checkLimits> } {
  const recorder = createTraceRecorder(options);
  const limits = checkLimits(scenario, options);
  const warnings: SolverWarning[] = [...limits.warnings];
  const emit = (event: SolverEvent): void => {
    recorder.record(event);
    context.emit(event);
  };
  return {
    startedAt: context.now(),
    recorder,
    warnings,
    counters: { expanded: 0, generated: 0, replans: 0, conflictsDetected: 0, stop: null },
    emit,
    options,
    context,
    limits,
  };
}

function validateOneShot(
  scenario: Scenario,
): { message: string; code: "invalid-scenario" | "unsupported-rules" } | null {
  if (scenario.kind !== "one-shot-mapf")
    return {
      message: "この LNS Solver は one-shot MAPF のみに対応します。",
      code: "unsupported-rules",
    };
  return validateCommonScenario(scenario, true);
}

function validateCommonScenario(
  scenario: Scenario,
  requireGoals: boolean,
): { message: string; code: "invalid-scenario" | "unsupported-rules" } | null {
  if (
    scenario.rules.allowDiagonal ||
    scenario.rules.forbidFollowing ||
    scenario.rules.goalBehavior !== "stay"
  ) {
    return {
      message:
        "このブラウザ版は 4 近傍・edge-swap 禁止・following 許可・stay-at-goal に限定しています。",
      code: "unsupported-rules",
    };
  }
  if (scenario.agents.length === 0)
    return { message: "エージェントが 1 体もありません。", code: "invalid-scenario" };
  const ids = new Set<string>();
  for (const agent of scenario.agents) {
    if (ids.has(agent.id))
      return { message: `agent ID ${agent.id} が重複しています。`, code: "invalid-scenario" };
    ids.add(agent.id);
    if (!isWalkable(scenario.map, agent.start))
      return { message: `${agent.id} の start が通行不能です。`, code: "invalid-scenario" };
    if (requireGoals && !agent.goal)
      return { message: `${agent.id} に goal が設定されていません。`, code: "invalid-scenario" };
    if (agent.goal && !isWalkable(scenario.map, agent.goal))
      return { message: `${agent.id} の goal が通行不能です。`, code: "invalid-scenario" };
  }
  return null;
}

function resolveMaxTime(
  scenario: Scenario,
  options: SolverOptions,
  warnings: SolverWarning[],
  label: string,
): number {
  const requested = options.horizon ?? defaultMaxTime(scenario);
  const max = Math.min(requested, options.maxHorizon);
  if (requested > options.maxHorizon)
    warnings.push({
      code: "input-too-large",
      message: `${label} の horizon を maxHorizon=${options.maxHorizon} に制限しました。`,
    });
  return max;
}

function deterministicRanks(count: number, context: SolverContext): readonly number[] {
  return Array.from({ length: count }, () => context.random());
}

function sumDistances(
  scenario: Scenario,
  agents: readonly (AgentSpec & { readonly goal: Cell })[],
  distances: readonly Float64Array[],
): number {
  let total = 0;
  for (let index = 0; index < agents.length; index += 1) {
    const distance = lookupDistance(scenario.map, distances[index]!, agents[index]!.start);
    if (!Number.isFinite(distance)) return Number.POSITIVE_INFINITY;
    total += distance;
  }
  return total;
}

async function planAll(
  scenario: Scenario,
  agents: readonly (AgentSpec & { readonly goal: Cell })[],
  order: readonly number[],
  fixed: ReadonlyMap<number, TimedPath>,
  maxTime: number,
  run: CommonRun,
  reservePlanned = true,
): Promise<{
  readonly complete: boolean;
  readonly paths: readonly TimedPath[];
  readonly failure?: SolverResult;
}> {
  const paths = new Map<number, TimedPath>(fixed);
  const table = new SimpleReservationTable();
  for (const path of fixed.values()) reservePathForRules(table, path, maxTime, scenario.rules);
  for (const index of order) {
    const agent = agents[index]!;
    const plan = planAgent(scenario, agent.id, agent.start, agent.goal, table, 0, maxTime, run);
    if (!plan.path) {
      return {
        complete: false,
        paths: [...paths.values()],
        failure: stopFailure(run, plan.reason, "priority-order"),
      };
    }
    paths.set(index, plan.path);
    if (reservePlanned) reservePathForRules(table, plan.path, maxTime, scenario.rules);
    run.counters.replans += 1;
    for (const position of plan.path.positions)
      run.emit({ type: "reserve", agentId: agent.id, cell: position.cell, time: position.time });
    run.emit({
      type: "progress",
      ratio: paths.size / agents.length,
      label: `${agent.id} を初期計画`,
    });
  }
  return { complete: true, paths: agents.map((_, index) => paths.get(index)!).filter(Boolean) };
}

async function repairPaths(
  scenario: Scenario,
  agents: readonly (AgentSpec & { readonly goal: Cell })[],
  oldPaths: readonly TimedPath[],
  selected: readonly number[],
  maxTime: number,
  run: CommonRun,
  ranks: readonly number[],
): Promise<{
  readonly paths: readonly TimedPath[] | null;
  readonly conflicts: readonly Conflict[];
}> {
  const selectedSet = new Set(selected);
  const paths = oldPaths.slice() as TimedPath[];
  const table = new SimpleReservationTable();
  for (let index = 0; index < agents.length; index += 1) {
    if (!selectedSet.has(index)) reservePathForRules(table, paths[index]!, maxTime, scenario.rules);
  }
  const order = [...selected].sort((a, b) => ranks[a]! - ranks[b]! || a - b);
  for (const index of order) {
    const agent = agents[index]!;
    const plan = planAgent(scenario, agent.id, agent.start, agent.goal, table, 0, maxTime, run);
    if (!plan.path) return { paths: null, conflicts: [] };
    paths[index] = plan.path;
    reservePathForRules(table, plan.path, maxTime, scenario.rules);
    run.counters.replans += 1;
  }
  const conflicts = detectConflicts(paths, scenario.rules);
  for (const conflict of conflicts.slice(0, 20)) run.emit({ type: "detect-conflict", conflict });
  return { paths, conflicts };
}

function planAgent(
  scenario: Scenario,
  agentId: string,
  start: Cell,
  goal: Cell,
  reservations: SimpleReservationTable,
  startTime: number,
  maxTime: number,
  run: CommonRun,
): PlanOutput {
  const output = spaceTimeAStar({
    map: scenario.map,
    start,
    goal,
    agentId,
    rules: scenario.rules,
    reservations,
    reservationHorizon: maxTime,
    startTime,
    maxTime,
    maxExpansions: Number.MAX_SAFE_INTEGER,
    consumeExpansion: () => consumeExpansion(run),
    heuristic: trueDistanceFrom(scenario.map, goal),
    onExpand: (cell, time, f) =>
      run.emit({ type: "expand-node", agentId, state: { phase: "lns-low-level", cell, time, f } }),
    onReject: (cell, time, reason) =>
      run.emit({ type: "reject-reserved-state", agentId, cell, time, reason }),
  });
  run.counters.generated += output.generated;
  return { path: output.path, reason: output.reason, generated: output.generated };
}

function consumeExpansion(run: CommonRun): "ok" | LowLevelStopReason {
  if (run.counters.stop)
    return run.counters.stop === "node-limit" ? "max-expansions" : run.counters.stop;
  const abort = checkAbort(
    run.startedAt,
    run.context.now,
    run.options.timeoutMs,
    run.context.signal,
  );
  if (abort !== "ok") {
    run.counters.stop = abort;
    return abort;
  }
  if (run.counters.expanded >= run.options.maxExpansions) {
    run.counters.stop = "node-limit";
    return "max-expansions";
  }
  run.counters.expanded += 1;
  return "ok";
}

function selectLnsNeighborhood(
  scenario: Scenario,
  agents: readonly (AgentSpec & { readonly goal: Cell })[],
  paths: readonly TimedPath[],
  size: number,
  strategy: LnsStrategy,
  tabu: Set<number>,
  random: () => number,
): readonly number[] {
  const n = agents.length;
  const selected = new Set<number>();
  if (strategy === "random") {
    const order = shuffledIndices(n, random);
    for (const index of order.slice(0, size)) selected.add(index);
  } else if (strategy === "map") {
    const intersections = [...Array(scenario.map.width * scenario.map.height).keys()].filter(
      (index) => {
        const cell = { x: index % scenario.map.width, y: Math.floor(index / scenario.map.width) };
        return (
          isWalkable(scenario.map, cell) &&
          neighbors(scenario.map, cell, scenario.rules).length >= 3
        );
      },
    );
    const cell = intersections.length
      ? intersections[Math.floor(random() * intersections.length)]!
      : 0;
    for (let index = 0; index < paths.length && selected.size < size; index += 1) {
      if (
        paths[index]!.positions.some((position) => cellIndex(scenario.map, position.cell) === cell)
      )
        selected.add(index);
    }
  } else {
    const scored = agents.map((agent, index) => ({
      index,
      score: pathDelay(scenario, agent, paths[index]!),
    }));
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    const first = scored.find((entry) => !tabu.has(entry.index)) ?? scored[0];
    if (first) {
      selected.add(first.index);
      tabu.add(first.index);
      if (tabu.size >= n) tabu.clear();
      const conflicts = detectConflicts(paths, scenario.rules);
      for (const conflict of conflicts) {
        const other =
          conflict.agentA === agents[first.index]!.id ? conflict.agentB : conflict.agentA;
        const otherIndex = agents.findIndex((agent) => agent.id === other);
        if (otherIndex >= 0) selected.add(otherIndex);
        if (selected.size >= size) break;
      }
    }
  }
  for (const index of shuffledIndices(n, random)) {
    if (selected.size >= size) break;
    selected.add(index);
  }
  return [...selected].slice(0, Math.min(size, n));
}

function selectLns2Neighborhood(
  scenario: Scenario,
  agents: readonly AgentSpec[],
  paths: readonly TimedPath[],
  size: number,
  strategy: LnsStrategy,
  random: () => number,
): readonly number[] {
  const conflicts = detectConflicts(paths, scenario.rules);
  const colliding = new Set<number>();
  for (const conflict of conflicts) {
    const a = agents.findIndex((agent) => agent.id === conflict.agentA);
    const b = agents.findIndex((agent) => agent.id === conflict.agentB);
    if (a >= 0) colliding.add(a);
    if (b >= 0) colliding.add(b);
  }
  const selected = new Set<number>();
  if (strategy === "agent" || strategy === "map") {
    for (const index of [...colliding].sort((a, b) => a - b)) {
      selected.add(index);
      if (selected.size >= size) break;
    }
  }
  const order = shuffledIndices(agents.length, random);
  for (const index of order) {
    if (selected.size >= size) break;
    selected.add(index);
  }
  return [...selected].slice(0, Math.min(size, agents.length));
}

function shuffledIndices(count: number, random: () => number): number[] {
  const order = Array.from({ length: count }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex]!, order[index]!];
  }
  return order;
}

function pathDelay(
  scenario: Scenario,
  agent: AgentSpec & { readonly goal: Cell },
  path: TimedPath,
): number {
  const distance = lookupDistance(
    scenario.map,
    trueDistanceFrom(scenario.map, agent.goal),
    agent.start,
  );
  return Math.max(
    0,
    (path.positions.length > 0 ? path.positions[path.positions.length - 1]!.time : 0) - distance,
  );
}

function countCollisionPairs(paths: readonly TimedPath[], scenario: Scenario): number {
  const pairs = new Set<string>();
  for (const conflict of detectConflicts(paths, scenario.rules)) {
    const [a, b] = [conflict.agentA, conflict.agentB].sort();
    pairs.add(`${a}|${b}`);
  }
  return pairs.size;
}

function weightedStrategy(weights: Record<LnsStrategy, number>, random: number): LnsStrategy {
  const total = weights.agent + weights.map + weights.random;
  const threshold = random * total;
  if (threshold < weights.agent) return "agent";
  if (threshold < weights.agent + weights.map) return "map";
  return "random";
}

function readStrategy(value: unknown): LnsStrategy | undefined {
  return value === "agent" || value === "map" || value === "random" ? value : undefined;
}

function readLns2Strategy(value: unknown): LnsStrategy | undefined {
  return readStrategy(value);
}

function readPositiveInt(value: unknown, fallback: number): number {
  return isPositiveInteger(value) ? value : fallback;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function buildGoalQueues(scenario: Scenario, agents: readonly AgentSpec[]): RhcrGoal[][] {
  const raw = scenario as Scenario & {
    readonly goalSequences?: Readonly<
      Record<string, readonly (Cell | { readonly cell: Cell; readonly releaseTime?: number })[]>
    >;
  };
  const configured = raw.goalSequences;
  return agents.map((agent) => {
    const sequence = configured?.[agent.id];
    if (sequence && sequence.length > 0) {
      return sequence.map((entry) => {
        if ("cell" in entry) {
          return {
            cell: { ...entry.cell },
            releaseTime: entry.releaseTime ?? 0,
          };
        }
        return { cell: { ...entry }, releaseTime: 0 };
      });
    }
    return agent.goal ? [{ cell: { ...agent.goal }, releaseTime: 0 }] : [];
  });
}

function rhcrSearchEnd(
  scenario: Scenario,
  currentTime: number,
  planningWindow: number,
  maxHorizon: number,
): number {
  const mapBudget = Math.min(scenario.map.width * scenario.map.height, maxHorizon);
  const searchBudget = Math.max(planningWindow, mapBudget);
  return Math.min(maxHorizon, currentTime + searchBudget);
}

function truncatePath(path: TimedPath, horizon: number): TimedPath {
  return {
    agentId: path.agentId,
    positions: path.positions.filter((position) => position.time <= horizon),
  };
}

function firstArrivalTime(
  path: TimedPath,
  goal: Cell,
  fromTime: number,
  toTime: number,
  rules: Scenario["rules"],
): number | undefined {
  for (let time = fromTime; time <= toTime; time += 1) {
    const cell = positionAt(path, time, rules);
    if (cell && cellEquals(cell, goal)) return time;
  }
  return undefined;
}

function waitPathFor(agentId: string, cell: Cell, startTime: number, endTime: number): TimedPath {
  return {
    agentId,
    positions: Array.from({ length: Math.max(0, endTime - startTime) + 1 }, (_, offset) => ({
      time: startTime + offset,
      cell: { ...cell },
    })),
  };
}

function resultFromPaths(
  scenario: Scenario,
  paths: readonly TimedPath[],
  run: CommonRun,
  outcome: SolverOutcome,
  failureReason?: FailureReason,
): SolverResult {
  const base = buildResult(
    scenario,
    paths,
    run.context.now() - run.startedAt,
    run.counters.expanded,
    outcome,
    {
      generatedNodes: run.counters.generated,
      conflictsDetected: run.counters.conflictsDetected,
      replans: run.counters.replans,
    },
  );
  return {
    ...base,
    metrics: { ...base.metrics },
    ...(failureReason ? { failureReason } : {}),
  };
}

function rhcrResult(
  scenario: Scenario,
  paths: readonly TimedPath[],
  run: CommonRun,
  outcome: SolverOutcome,
  serviceTimes: readonly number[],
  pendingTasks: number,
): SolverResult {
  const base = buildResult(
    scenario,
    paths,
    run.context.now() - run.startedAt,
    run.counters.expanded,
    outcome,
    {
      generatedNodes: run.counters.generated,
      conflictsDetected: run.counters.conflictsDetected,
      replans: run.counters.replans,
    },
  );
  const horizon = Math.max(1, makespanOf(paths));
  const averageServiceTime = serviceTimes.length
    ? serviceTimes.reduce((sum, value) => sum + value, 0) / serviceTimes.length
    : undefined;
  return {
    ...base,
    metrics: {
      ...base.metrics,
      runtimeMs: run.context.now() - run.startedAt,
      ...(averageServiceTime !== undefined ? { averageServiceTime } : {}),
      throughput: serviceTimes.length / horizon,
      pendingTasks,
    },
  };
}

function checkRunStop(
  run: CommonRun,
  options: SolverOptions,
  context: SolverContext,
): Exclude<StopState, "max-expansions"> {
  const abort = checkAbort(run.startedAt, context.now, options.timeoutMs, context.signal);
  if (abort !== "ok") {
    run.counters.stop = abort;
    return abort;
  }
  if (run.counters.expanded >= options.maxExpansions) {
    run.counters.stop = "node-limit";
    return "node-limit";
  }
  return null;
}

function stopFailure(
  run: CommonRun,
  reason: PlanOutput["reason"],
  fallback: FailureReason,
): SolverResult {
  if (reason === "timeout" || reason === "aborted")
    return failureResult(run, reason, "limit-exceeded");
  if (reason === "max-expansions") return failureResult(run, "node-limit", "limit-exceeded");
  return failureResult(run, "no-solution", fallback);
}

function mapStop(reason: PlanOutput["reason"]): Exclude<SolverOutcome, "solved" | "error"> {
  if (reason === "timeout" || reason === "aborted" || reason === "max-expansions")
    return reason === "max-expansions" ? "node-limit" : reason;
  return "no-solution";
}

function finishLns(run: CommonRun, base: SolverResult): SolverResult {
  const warnings = [...run.warnings, ...(base.warnings ?? [])];
  const result: SolverResult = {
    ...base,
    metrics: { ...base.metrics, runtimeMs: Math.max(0, base.metrics.runtimeMs || 0) },
    ...(warnings.length ? { warnings } : {}),
  };
  run.emit({ type: "finish", result });
  const finalWarnings = [...warnings, ...run.recorder.warnings];
  return {
    ...result,
    ...(finalWarnings.length ? { warnings: finalWarnings } : {}),
    ...(run.recorder.events.length ? { trace: run.recorder.events } : {}),
  };
}

function addIncompleteWarning(
  run: CommonRun,
  solverName: string,
  detail: string,
  nature = "不完全な anytime 手法",
): void {
  run.warnings.push({
    code: "simplified-behavior",
    message: `${solverName} は${nature}です。${detail}これは解の非存在の証明ではありません。`,
  });
}

/** RHCR が solved 以外で終わった理由を、警告に添える一文にする。 */
function rhcrFailureDetail(outcome: SolverOutcome, horizonExhausted: boolean): string {
  if (horizonExhausted) return "goal を処理しきる前に運転時間が尽きました。";
  if (outcome === "no-solution")
    return "window 内の優先順位付き計画で全 agent の path を作れませんでした。";
  return "実行上限に達して打ち切りました。";
}

function errorResult(
  run: CommonRun,
  message: string,
  code: "invalid-scenario" | "unsupported-rules",
): SolverResult {
  return {
    outcome: "error",
    paths: [],
    metrics: {
      sumOfCosts: 0,
      makespan: 0,
      runtimeMs: run.context.now() - run.startedAt,
      expandedNodes: run.counters.expanded,
    },
    conflicts: [],
    error: { code, message },
    failureReason: code === "unsupported-rules" ? "unsupported-rules" : "internal",
  };
}

function failureResult(
  run: CommonRun,
  outcome: Exclude<SolverOutcome, "solved" | "error">,
  reason: FailureReason,
): SolverResult {
  return {
    outcome,
    paths: [],
    metrics: {
      sumOfCosts: 0,
      makespan: 0,
      runtimeMs: run.context.now() - run.startedAt,
      expandedNodes: run.counters.expanded,
      generatedNodes: run.counters.generated,
    },
    conflicts: [],
    failureReason: reason,
  };
}
