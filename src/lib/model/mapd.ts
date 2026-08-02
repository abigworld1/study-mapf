import type { Cell, Scenario } from "./types.js";
import { cellKey, isWalkable, neighbors } from "./grid.js";

/**
 * MAPD の endpoint とその判定。
 *
 * すべて mapd-tp-tpts-central-2017 p.2 §3.2 の定義に従う。こちらの都合で
 * 決めたものは 1 つも無い。TP / TPTS の保証（同 p.4 Theorem 3）は
 * well-formed であることを前提にしているので、ここが崩れると
 * Batch 8 の手法は「保証の対象外」になる。
 */

/**
 * 論文の endpoint 集合。
 *
 *   V_ep  = エージェントの初期位置 ∪ 全タスクの pickup/delivery ∪ 追加の parking
 *   V_tsk = 全タスクの pickup/delivery（task endpoints）
 *   V_ep \ V_tsk = non-task endpoints
 *
 * ★ エージェントが「永久に留まってよい」のは endpoint だけ、というのが
 *   この定義の狙い。論文の言葉では
 *   「agents should only be allowed to rest (that is, stay forever) in
 *     locations, called endpoints, where they cannot block other agents」。
 */
export interface MapdEndpoints {
  readonly all: readonly Cell[];
  readonly task: readonly Cell[];
  readonly nonTask: readonly Cell[];
}

export function endpointsOf(scenario: Scenario): MapdEndpoints {
  const task = new Map<string, Cell>();
  for (const spec of scenario.tasks ?? []) {
    task.set(cellKey(spec.pickup), spec.pickup);
    task.set(cellKey(spec.delivery), spec.delivery);
  }
  const all = new Map<string, Cell>(task);
  for (const agent of scenario.agents) all.set(cellKey(agent.start), agent.start);
  for (const cell of scenario.parkingEndpoints ?? []) all.set(cellKey(cell), cell);

  const nonTask: Cell[] = [];
  for (const [key, cell] of all) if (!task.has(key)) nonTask.push(cell);

  return { all: [...all.values()], task: [...task.values()], nonTask };
}

/**
 * 条件 (c) の検査量の上限。
 *
 * ★ 総当たりは endpoint 対の数 × グリッド BFS になる。教材用の小さい盤面なら
 *   問題ないが、生成したタスクが多いと endpoint が増えて跳ね上がる。
 *   超えたら「検査しなかった」と正直に返す。判定できていないものを
 *   well-formed と呼ばないため。
 */
const MAX_ENDPOINT_PAIRS = 400;

export interface WellFormedResult {
  /** 3 条件すべてを満たすことを確認できたか。checked が false なら常に false。 */
  readonly wellFormed: boolean;
  /** 条件 (c) まで検査しきれたか。上限超過で省略した場合は false。 */
  readonly checked: boolean;
  /** 満たさなかった条件の説明。日本語。 */
  readonly violations: readonly string[];
  readonly endpoints: MapdEndpoints;
}

/**
 * mapd-tp-tpts-central-2017 p.2 Definition 1 の検査。
 *
 *   「A MAPD instance is well-formed iff
 *     a) the number of tasks is finite,
 *     b) there are no fewer non-task endpoints than the number of agents, and
 *     c) for any two endpoints, there exists a path between them that
 *        traverses no other endpoints.」
 *
 * ★ これは十分条件であって必要条件ではない（同 p.2「We now provide a
 *   sufficient condition that makes MAPD instances solvable」）。
 *   well-formed でない ＝ 解けない、ではない。UI の文言でも混同しないこと。
 */
export function checkWellFormed(scenario: Scenario): WellFormedResult {
  const endpoints = endpointsOf(scenario);
  const violations: string[] = [];

  // (a) タスクが有限。配列で持っている以上つねに有限なので、記録だけしておく。

  // (b) non-task endpoint がエージェント数以上あること。
  if (endpoints.nonTask.length < scenario.agents.length) {
    violations.push(
      `条件 (b): non-task endpoint が ${endpoints.nonTask.length} 個しかなく、` +
        `エージェント ${scenario.agents.length} 体より少ない。` +
        "全員が同時に他を塞がない場所へ退けないため、待避が詰まりうる",
    );
  }

  // (c) 任意の 2 endpoint 間に、他の endpoint を通らない経路があること。
  const pairs = (endpoints.all.length * (endpoints.all.length - 1)) / 2;
  const checked = pairs <= MAX_ENDPOINT_PAIRS;
  if (checked) {
    const blocked = new Set(endpoints.all.map(cellKey));
    for (let i = 0; i < endpoints.all.length; i += 1) {
      for (let j = i + 1; j < endpoints.all.length; j += 1) {
        const from = endpoints.all[i]!;
        const to = endpoints.all[j]!;
        if (!hasPathAvoidingOtherEndpoints(scenario, from, to, blocked)) {
          violations.push(
            `条件 (c): (${from.x},${from.y}) と (${to.x},${to.y}) を結ぶ経路が、` +
              "必ず別の endpoint を通る",
          );
        }
      }
    }
  }

  return {
    wellFormed: checked && violations.length === 0,
    checked,
    violations,
    endpoints,
  };
}

/**
 * from から to まで、両端以外の endpoint を一切通らずに行けるか。
 *
 * ★ 両端は通ってよい（そこが始点と終点なので）。それ以外の endpoint は
 *   壁と同じ扱いにして BFS する。論文の
 *   「there exists a path between them that traverses no other endpoints」
 *   をそのまま検査している。
 */
function hasPathAvoidingOtherEndpoints(
  scenario: Scenario,
  from: Cell,
  to: Cell,
  endpointKeys: ReadonlySet<string>,
): boolean {
  const fromKey = cellKey(from);
  const toKey = cellKey(to);
  const passable = (cell: Cell): boolean => {
    if (!isWalkable(scenario.map, cell)) return false;
    const key = cellKey(cell);
    return !endpointKeys.has(key) || key === fromKey || key === toKey;
  };
  if (!passable(from) || !passable(to)) return false;

  const seen = new Set<string>([fromKey]);
  let frontier: Cell[] = [from];
  while (frontier.length > 0) {
    const next: Cell[] = [];
    for (const cell of frontier) {
      if (cellKey(cell) === toKey) return true;
      for (const neighbor of neighbors(scenario.map, cell, scenario.rules)) {
        const key = cellKey(neighbor);
        if (seen.has(key) || !passable(neighbor)) continue;
        seen.add(key);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return false;
}
