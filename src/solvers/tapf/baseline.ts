import type {
  AgentSpec,
  Cell,
  MapfSolver,
  Scenario,
  SolverContext,
  SolverOptions,
  SolverResult,
  SolverWarning,
  TeamSpec,
} from "@/lib/model/types.js";
import { makespanOf, sumOfCosts } from "@/lib/model/conflicts.js";
import { validateScenario } from "@/lib/model/scenario.js";
import { solveCbsVariant } from "../cbs/core.js";

/**
 * 列挙する割当の組合せ数の上限。
 *
 * ★ 総数は各チームの K_i! の積で、7 体 1 チームで 5040、8 体で 40320 になる。
 *   1 通りごとに CBS を丸ごと 1 回走らせるので、ブラウザではここで止める。
 *   これは実装の都合ではなく手法そのものの性質で、cbm-tapf-aamas-2016 p.2 が
 *   「全割当を探索して最適解を求めるやり方は scalability に難がある」と
 *   名指ししているとおりのもの。だから CBM が要る、という話につながる。
 */
const MAX_ASSIGNMENTS = 5040;

export const tapfBaselineSolver: MapfSolver = {
  metadata: {
    id: "tapf-baseline",
    displayName: "全探索割当 + CBS",
    originalName: "Exhaustive target assignment + CBS",
    category: "tapf",
    supports: ["tapf"],
    status: "runnable",
    fidelity: "educational",
    unsupportedRules: ["allowDiagonal", "goalBehavior"],
    basedOnPaperIds: ["cbm-tapf-aamas-2016", "cbs-aij-2015"],
    implementationNote:
      "チーム内の割当（順列）を全通り試し、それぞれ CBS で解いて makespan 最小を選ぶ。cbm-tapf-aamas-2016 p.2 が「scalability に難がある」と名指しした素朴な方法そのもので、CBM / CBS-TA の比較対象と最適性の検証用に置いている。組合せ数が上限を超える入力は受け付けない。",
  },
  canSolve: (scenario) =>
    scenario.kind === "tapf" &&
    (scenario.teams?.length ?? 0) > 0 &&
    scenario.assignment === undefined,
  async solve(scenario, options, context): Promise<SolverResult> {
    return solveTapfBaseline(scenario, options, context);
  },
};

async function solveTapfBaseline(
  scenario: Scenario,
  options: SolverOptions,
  context: SolverContext,
): Promise<SolverResult> {
  const startedAt = context.now();
  const warnings: SolverWarning[] = [];

  if (scenario.kind !== "tapf") {
    return errorResult(
      startedAt,
      context,
      "この Solver は TAPF の Scenario にのみ対応します。",
      "unsupported-rules",
    );
  }
  const problems = validateScenario(scenario);
  if (problems.length > 0) {
    return errorResult(startedAt, context, problems.join(" / "), "invalid-scenario");
  }
  const teams = scenario.teams ?? [];

  const total = teams.reduce((product, team) => product * factorial(team.agentIds.length), 1);
  if (total > MAX_ASSIGNMENTS) {
    return errorResult(
      startedAt,
      context,
      `割当の組合せが ${total} 通りあり、上限 ${MAX_ASSIGNMENTS} を超えます。` +
        "この方法は全通りを試すため、チームを小さくしてください。",
      "invalid-scenario",
    );
  }

  /*
    ★ 目的関数の但し書き。TAPF は手法ごとに最小化する量が違う。
      CBM は makespan（cbm-tapf-aamas-2016 p.2）、
      CBS-TA は sum of costs（cbs-ta-aamas-2018 p.2）で、
      CBS-TA 論文 p.1 自身が両者を区別している。
      画面は SOC も makespan も出すので、どちらを最適化したのか
      言わないと「どの数値も最適」と読まれる（SOURCE_POLICY.md 第 8 条）。
  */
  warnings.push({
    code: "simplified-behavior",
    message:
      "この実装が最小化したのは makespan です（CBM と同じ目的関数）。表示されている sum of costs は最適値ではありません。CBS-TA は逆に sum of costs を最小化します。",
  });
  warnings.push({
    code: "simplified-behavior",
    message: `チーム内の割当を ${total} 通り全て試して CBS で解いています。組合せ数はチーム人数の階乗で増えるため、この方法は大きな問題には使えません。CBM や CBS-TA はそこを避けるための手法です。`,
  });

  const assignmentsList = enumerateAssignments(teams);
  const perRunOptions: SolverOptions = {
    ...options,
    // 1 通りごとに全体の予算を渡すと、最初の 1 通りで使い切る。
    timeoutMs: Math.max(50, Math.floor(options.timeoutMs / Math.max(1, assignmentsList.length))),
    traceLevel: "off",
  };

  let best: { result: SolverResult; assignment: AssignmentMap } | undefined;
  let solvedCount = 0;
  let expanded = 0;
  for (const [index, assignment] of assignmentsList.entries()) {
    if (context.signal.aborted) break;
    if (context.now() - startedAt >= options.timeoutMs) break;
    const derived = withAssignment(scenario, assignment);
    const result = await solveCbsVariant(derived, perRunOptions, silentContext(context), {
      variant: "cbs",
      lowLevelWeight: 1,
      highLevelWeight: 1,
    });
    expanded += result.metrics.expandedNodes ?? 0;
    context.emit({
      type: "progress",
      ratio: (index + 1) / assignmentsList.length,
      label: `割当 ${index + 1}/${assignmentsList.length} を CBS で評価`,
    });
    if (result.outcome !== "solved") continue;
    solvedCount += 1;
    context.emit({
      type: "accept-solution",
      cost: makespanOf(result.paths),
      iteration: index,
    });
    if (best === undefined || isBetter(result, best.result)) {
      best = { result, assignment };
      context.emit({
        type: "update-incumbent",
        cost: makespanOf(result.paths),
        iteration: index,
      });
    }
  }

  if (!best) {
    /*
      ★ 全通り試して 1 つも解けなかった場合。
        探索が尽きたなら本当に解が無いが、時間切れや上限で打ち切った場合は
        そうではない。CBS 自体も maxHorizon などで打ち切られうるので、
        「解なしの証明」と言えるのは全通り完走したときだけ。
    */
    const exhausted = !context.signal.aborted && context.now() - startedAt < options.timeoutMs;
    warnings.push({
      code: "simplified-behavior",
      message: exhausted
        ? `${assignmentsList.length} 通りの割当すべてで CBS が解を返しませんでした。CBS 側も探索上限で打ち切られることがあるため、これだけでは解が存在しないことの証明にはなりません。`
        : "全ての割当を試し終える前に打ち切ったため、これは解の非存在の証明ではありません。",
    });
    return {
      outcome: exhausted ? "no-solution" : "timeout",
      paths: [],
      metrics: {
        sumOfCosts: 0,
        makespan: 0,
        runtimeMs: context.now() - startedAt,
        expandedNodes: expanded,
      },
      conflicts: [],
      failureReason: exhausted ? "search-exhausted" : "limit-exceeded",
      warnings,
      objective: "makespan",
    };
  }

  if (solvedCount < assignmentsList.length) {
    warnings.push({
      code: "simplified-behavior",
      message: `${assignmentsList.length} 通りのうち ${solvedCount} 通りしか評価できませんでした。残りは CBS が解を返さなかったか、時間内に終わりませんでした。返した解が makespan 最小である保証はこの範囲に限られます。`,
    });
  }

  return {
    ...best.result,
    metrics: {
      ...best.result.metrics,
      runtimeMs: context.now() - startedAt,
      expandedNodes: expanded,
    },
    warnings: [...warnings, ...(best.result.warnings ?? [])],
    targetAssignments: toTargetAssignments(teams, best.assignment),
    objective: "makespan",
  };
}

/** agentId -> 割り当てられた target。 */
type AssignmentMap = ReadonlyMap<string, Cell>;

/**
 * チームごとの順列を全て組み合わせる。
 * cbm-tapf-aamas-2016 p.2 の「チーム内の 1 対 1 写像 φ^i」の全列挙にあたる。
 */
function enumerateAssignments(teams: readonly TeamSpec[]): AssignmentMap[] {
  let combos: Map<string, Cell>[] = [new Map()];
  for (const team of teams) {
    const next: Map<string, Cell>[] = [];
    for (const order of permutations(team.goals)) {
      for (const base of combos) {
        const merged = new Map(base);
        team.agentIds.forEach((agentId, index) => merged.set(agentId, order[index]!));
        next.push(merged);
      }
    }
    combos = next;
  }
  return combos;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += 1) {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) out.push([items[index]!, ...tail]);
  }
  return out;
}

function factorial(n: number): number {
  let out = 1;
  for (let i = 2; i <= n; i += 1) out *= i;
  return out;
}

/** 割当を固定して、通常の（非匿名）MAPF インスタンスに変換する。 */
function withAssignment(scenario: Scenario, assignment: AssignmentMap): Scenario {
  const agents: AgentSpec[] = scenario.agents.map((agent) => ({
    ...agent,
    goal: assignment.get(agent.id) ?? agent.start,
  }));
  return { ...scenario, kind: "one-shot-mapf", agents };
}

/**
 * makespan が小さいほど良い。同じなら sum of costs で決める。
 *
 * ★ tie-break に SOC を使うのは、CBM の最適性が makespan についてのみ
 *   主張されているため（cbm-tapf-aamas-2016 p.2）。makespan が同じ解が
 *   複数あるとき、論文はどれを返すか決めていないので、
 *   決定的にするための独自ルールであることをノートに書く。
 */
function isBetter(candidate: SolverResult, incumbent: SolverResult): boolean {
  const a = makespanOf(candidate.paths);
  const b = makespanOf(incumbent.paths);
  if (a !== b) return a < b;
  return sumOfCosts(candidate.paths) < sumOfCosts(incumbent.paths);
}

function toTargetAssignments(
  teams: readonly TeamSpec[],
  assignment: AssignmentMap,
): SolverResult["targetAssignments"] {
  const out: { agentId: string; teamId: string; goal: Cell }[] = [];
  for (const team of teams) {
    for (const agentId of team.agentIds) {
      const goal = assignment.get(agentId);
      if (goal) out.push({ agentId, teamId: team.id, goal });
    }
  }
  return out;
}

/**
 * 内側の CBS が出すイベントは捨てる。
 *
 * ★ 割当 1 通りごとに CBS の CT 展開イベントが全部流れてくると、
 *   数千件 × 組合せ数になって UI が固まる。外側の進捗だけ見せる。
 */
function silentContext(context: SolverContext): SolverContext {
  return { ...context, emit: () => {} };
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
    metrics: {
      sumOfCosts: 0,
      makespan: 0,
      runtimeMs: context.now() - startedAt,
      expandedNodes: 0,
    },
    conflicts: [],
    error: { code, message },
    failureReason: code === "unsupported-rules" ? "unsupported-rules" : "internal",
  };
}
