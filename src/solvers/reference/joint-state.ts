import type { Cell, Scenario, TimedPath, Time } from "@/lib/model/types.js";
import {
  cellEquals,
  isWalkable,
  lookupDistance,
  movesWithWait,
  trueDistanceFrom,
} from "@/lib/model/grid.js";
import { detectConflicts, makespanOf, sumOfCosts } from "@/lib/model/conflicts.js";

/**
 * 総当たりの参照ソルバ（オラクル）。
 *
 * ★ これはサイトに出す Solver ではない。テストで「最適解法が本当に最適か」を
 *   確かめるためだけのもの。registry に登録してはならない。
 *
 * ★ 極小インスタンス専用。
 *   状態は全エージェント位置の組（joint configuration）なので、
 *   状態数はセル数のエージェント数乗で増える。
 *   目安: エージェント 4 体 / 通行可能セル 25 以下。
 *   それを超えると呼び出し側で例外を投げる。
 *
 * 何を保証するか:
 *   - makespan 最適: 保証する。構成グラフ上の BFS なので反例の余地がない
 *   - sum of costs 最適: 条件付きで保証する（下の注意を読むこと）
 */

const MAX_AGENTS = 5;
const MAX_FREE_CELLS = 36;

export class ReferenceSolverTooLarge extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceSolverTooLarge";
  }
}

function assertTiny(scenario: Scenario): void {
  const free = scenario.map.blocked.filter((b) => !b).length;
  if (scenario.agents.length > MAX_AGENTS) {
    throw new ReferenceSolverTooLarge(
      `参照ソルバはエージェント ${MAX_AGENTS} 体までです（${scenario.agents.length} 体が渡されました）`,
    );
  }
  if (free > MAX_FREE_CELLS) {
    throw new ReferenceSolverTooLarge(
      `参照ソルバは通行可能セル ${MAX_FREE_CELLS} 個までです（${free} 個が渡されました）`,
    );
  }
  for (const agent of scenario.agents) {
    if (!agent.goal) throw new ReferenceSolverTooLarge(`${agent.id} に目標がありません`);
  }
}

type Config = readonly Cell[];

function configKey(config: Config): string {
  return config.map((c) => `${c.x},${c.y}`).join("|");
}

/** 1 ステップ分の合法な遷移をすべて列挙する（vertex / edge-swap / following を考慮）。 */
function* successors(scenario: Scenario, config: Config): Generator<Config> {
  const perAgent = config.map((cell) => movesWithWait(scenario.map, cell, scenario.rules));
  const next: Cell[] = new Array(config.length);

  function* rec(i: number): Generator<Config> {
    if (i === config.length) {
      yield next.slice();
      return;
    }
    for (const candidate of perAgent[i]!) {
      // vertex conflict
      let ok = true;
      for (let j = 0; j < i; j += 1) {
        if (cellEquals(next[j]!, candidate)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      // edge-swap conflict
      if (scenario.rules.forbidEdgeSwap) {
        for (let j = 0; j < i; j += 1) {
          if (cellEquals(config[i]!, next[j]!) && cellEquals(config[j]!, candidate)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
      }

      // following conflict
      if (scenario.rules.forbidFollowing) {
        for (let j = 0; j < i; j += 1) {
          if (cellEquals(candidate, config[j]!) && !cellEquals(config[j]!, next[j]!)) {
            ok = false;
            break;
          }
          if (cellEquals(next[j]!, config[i]!) && !cellEquals(config[i]!, candidate)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
      }

      next[i] = candidate;
      yield* rec(i + 1);
    }
  }

  yield* rec(0);
}

function toPaths(scenario: Scenario, configs: readonly Config[]): TimedPath[] {
  return scenario.agents.map((agent, i) => ({
    agentId: agent.id,
    positions: configs.map((config, time) => ({ time, cell: config[i]! })),
  }));
}

export interface ReferenceResult {
  readonly solved: boolean;
  readonly paths: readonly TimedPath[];
  readonly makespan: number;
  readonly sumOfCosts: number;
  /**
   * sum of costs の最適性を証明できたか。
   * false の場合、返した値は「見つかった中で最良」であって最適とは限らない。
   */
  readonly sumOfCostsCertified: boolean;
}

/**
 * makespan 最適解を求める。構成グラフ上の BFS。
 *
 * ★ makespan の最適性は保証する。
 */
export function jointStateBfs(scenario: Scenario, maxTime: Time = 40): ReferenceResult {
  assertTiny(scenario);

  const start: Config = scenario.agents.map((a) => a.start);
  const goal: Config = scenario.agents.map((a) => a.goal!);
  for (const cell of [...start, ...goal]) {
    if (!isWalkable(scenario.map, cell)) {
      return { solved: false, paths: [], makespan: 0, sumOfCosts: 0, sumOfCostsCertified: true };
    }
  }

  const isGoal = (config: Config) => config.every((c, i) => cellEquals(c, goal[i]!));
  if (isGoal(start)) {
    const paths = toPaths(scenario, [start]);
    return { solved: true, paths, makespan: 0, sumOfCosts: 0, sumOfCostsCertified: true };
  }

  const parent = new Map<string, { config: Config; prev: string | null }>();
  const startKey = configKey(start);
  parent.set(startKey, { config: start, prev: null });

  let frontier: Config[] = [start];
  for (let t = 1; t <= maxTime; t += 1) {
    const nextFrontier: Config[] = [];
    for (const config of frontier) {
      const fromKey = configKey(config);
      for (const succ of successors(scenario, config)) {
        const key = configKey(succ);
        if (parent.has(key)) continue;
        parent.set(key, { config: succ, prev: fromKey });
        if (isGoal(succ)) {
          const configs = reconstruct(parent, key);
          const paths = toPaths(scenario, configs);
          return {
            solved: true,
            paths,
            makespan: configs.length - 1,
            sumOfCosts: sumOfCosts(paths),
            sumOfCostsCertified: false, // makespan 最適であって SOC 最適ではない
          };
        }
        nextFrontier.push(succ);
      }
    }
    if (nextFrontier.length === 0) break;
    frontier = nextFrontier;
  }

  return { solved: false, paths: [], makespan: 0, sumOfCosts: 0, sumOfCostsCertified: true };
}

function reconstruct(
  parent: Map<string, { config: Config; prev: string | null }>,
  key: string,
): Config[] {
  const out: Config[] = [];
  let current: string | null = key;
  while (current !== null) {
    const entry: { config: Config; prev: string | null } = parent.get(current)!;
    out.push(entry.config);
    current = entry.prev;
  }
  out.reverse();
  return out;
}

/**
 * sum of costs 最適解を求める。
 *
 * ★ 手法: makespan を 0 から増やしながら、その makespan 以内で到達可能な
 *   すべての「全員ゴール」構成列を列挙し、実際の sumOfCosts() で評価して最小を取る。
 *   列挙は指数的なので、極小インスタンス専用。
 *
 * ★ 打ち切りに注意。
 *   maxMakespan までしか探さないため、それより長い解にしか最適が無い場合は
 *   sumOfCostsCertified = false で返す。
 *   テストでは makespan 最適 + 余裕（slack）を渡すこと。
 *
 * ★ なぜ単純な Dijkstra にしないか:
 *   「ゴールで待つのは無料」という素朴なコスト関数は、
 *   一度ゴールに着いてから他を通すために離れる経路を過小評価する。
 *   オラクルが間違うと検証の意味が無くなるため、実コストで評価し直す方式にした。
 */
export function jointStateOptimalSumOfCosts(
  scenario: Scenario,
  maxExtraCost = 12,
): ReferenceResult {
  assertTiny(scenario);

  const start: Config = scenario.agents.map((a) => a.start);
  const goal: Config = scenario.agents.map((a) => a.goal!);
  const isGoal = (config: Config) => config.every((c, i) => cellEquals(c, goal[i]!));

  // 各エージェントの真距離。他エージェントを無視した下界なので許容ヒューリスティクス。
  const dist = scenario.agents.map((a) => trueDistanceFrom(scenario.map, a.goal!));
  const heuristic = (config: Config): number => {
    let sum = 0;
    for (let i = 0; i < config.length; i += 1) {
      const d = lookupDistance(scenario.map, dist[i]!, config[i]!);
      if (!Number.isFinite(d)) return Number.POSITIVE_INFINITY;
      sum += d;
    }
    return sum;
  };

  const lowerBound = heuristic(start);
  if (!Number.isFinite(lowerBound)) {
    return { solved: false, paths: [], makespan: 0, sumOfCosts: 0, sumOfCostsCertified: true };
  }
  if (isGoal(start)) {
    const paths = toPaths(scenario, [start]);
    return { solved: true, paths, makespan: 0, sumOfCosts: 0, sumOfCostsCertified: true };
  }

  /**
   * 1 ステップの暫定コスト。
   * ゴールに居て動かないエージェントは無料にする。
   *
   * ★ この g は真の sum of costs の「下界」である。
   *   一度ゴールに着いてから他を通すために離れる経路では過小評価になるため、
   *   これだけで最適値を主張してはならない。
   *   下界であることを利用して枝刈りにだけ使い、採否は実コストで判定する。
   */
  const stepCost = (from: Config, to: Config): number => {
    let cost = 0;
    for (let i = 0; i < from.length; i += 1) {
      const parked = cellEquals(from[i]!, goal[i]!) && cellEquals(to[i]!, goal[i]!);
      if (!parked) cost += 1;
    }
    return cost;
  };

  // IDA*: 予算を下界から 1 ずつ上げる。
  // g は下界なので g + h > budget での枝刈りは最適解を落とさない。
  // 採用は実際の sumOfCosts() で判定するので、最初に見つかった時点で最適。
  for (let budget = lowerBound; budget <= lowerBound + maxExtraCost; budget += 1) {
    const bestG = new Map<string, number>();
    const path: Config[] = [start];

    const dfs = (g: number): TimedPath[] | null => {
      const current = path[path.length - 1]!;

      if (isGoal(current)) {
        const paths = toPaths(scenario, path);
        // 列挙側の取りこぼしを検出するため、実際の衝突判定でも検査する
        if (detectConflicts(paths, scenario.rules).length === 0 && sumOfCosts(paths) <= budget) {
          return paths;
        }
        return null;
      }

      const h = heuristic(current);
      if (!Number.isFinite(h) || g + h > budget) return null;
      // SOC が budget 以下なら、どのエージェントの到達時刻も budget を超えない
      if (path.length - 1 >= budget) return null;

      const key = `${configKey(current)}@${path.length - 1}`;
      const seen = bestG.get(key);
      if (seen !== undefined && seen <= g) return null;
      bestG.set(key, g);

      for (const succ of successors(scenario, current)) {
        path.push(succ);
        const found = dfs(g + stepCost(current, succ));
        if (found) return found;
        path.pop();
      }
      return null;
    };

    const found = dfs(0);
    if (found) {
      return {
        solved: true,
        paths: found,
        makespan: makespanOf(found),
        sumOfCosts: sumOfCosts(found),
        sumOfCostsCertified: true,
      };
    }
  }

  // 予算を上げきっても見つからなかった。解が無いのか、予算不足なのか区別できない。
  return { solved: false, paths: [], makespan: 0, sumOfCosts: 0, sumOfCostsCertified: false };
}
