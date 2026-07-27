import type { AgentSpec, Cell, GridMap, Scenario, SimulationRules, TaskSpec } from "./types.js";
import { DEFAULT_RULES } from "./types.js";
import { createEmptyMap, isWalkable, withBlocked } from "./grid.js";
import { createRandom, randomInt } from "./random.js";

/** シナリオ JSON の形式。import/export で使う。 */
export interface ScenarioJson {
  readonly formatVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly kind: Scenario["kind"];
  readonly width: number;
  readonly height: number;
  /** 1 行 1 文字列。'.' = 通行可、'@' = 壁。Moving AI に合わせている。 */
  readonly map: readonly string[];
  readonly agents: readonly {
    id: string;
    start: [number, number];
    goal?: [number, number];
    colorIndex?: number;
  }[];
  readonly tasks?: readonly {
    id: string;
    pickup: [number, number];
    delivery: [number, number];
    releaseTime: number;
  }[];
  readonly rules: SimulationRules;
  readonly seed: number;
  readonly attribution?: string;
}

export function scenarioToJson(scenario: Scenario): ScenarioJson {
  const rows: string[] = [];
  for (let y = 0; y < scenario.map.height; y += 1) {
    let row = "";
    for (let x = 0; x < scenario.map.width; x += 1) {
      row += scenario.map.blocked[y * scenario.map.width + x] ? "@" : ".";
    }
    rows.push(row);
  }
  return {
    formatVersion: 1,
    id: scenario.id,
    name: scenario.name,
    kind: scenario.kind,
    width: scenario.map.width,
    height: scenario.map.height,
    map: rows,
    agents: scenario.agents.map((a) => ({
      id: a.id,
      start: [a.start.x, a.start.y] as [number, number],
      ...(a.goal ? { goal: [a.goal.x, a.goal.y] as [number, number] } : {}),
      ...(a.colorIndex !== undefined ? { colorIndex: a.colorIndex } : {}),
    })),
    ...(scenario.tasks && scenario.tasks.length > 0
      ? {
          tasks: scenario.tasks.map((t) => ({
            id: t.id,
            pickup: [t.pickup.x, t.pickup.y] as [number, number],
            delivery: [t.delivery.x, t.delivery.y] as [number, number],
            releaseTime: t.releaseTime,
          })),
        }
      : {}),
    rules: scenario.rules,
    seed: scenario.seed,
    ...(scenario.attribution ? { attribution: scenario.attribution } : {}),
  };
}

export class ScenarioParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioParseError";
  }
}

export function scenarioFromJson(input: unknown): Scenario {
  if (typeof input !== "object" || input === null) {
    throw new ScenarioParseError("JSON がオブジェクトではありません");
  }
  const json = input as Partial<ScenarioJson>;
  if (json.formatVersion !== 1) {
    throw new ScenarioParseError(`未知の formatVersion: ${String(json.formatVersion)}`);
  }
  const width = json.width ?? 0;
  const height = json.height ?? 0;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new ScenarioParseError("width / height が不正です");
  }
  const rows = json.map ?? [];
  if (rows.length !== height) {
    throw new ScenarioParseError(
      `map の行数が height と一致しません（${rows.length} ≠ ${height}）`,
    );
  }
  const blocked: boolean[] = new Array(width * height).fill(false);
  rows.forEach((row, y) => {
    if (row.length !== width) {
      throw new ScenarioParseError(`map の ${y} 行目の長さが width と一致しません`);
    }
    for (let x = 0; x < width; x += 1) {
      blocked[y * width + x] = row[x] !== ".";
    }
  });

  const map: GridMap = { width, height, blocked };
  const toCell = (pair: [number, number] | undefined, label: string): Cell => {
    if (!pair || pair.length !== 2) throw new ScenarioParseError(`${label} の座標が不正です`);
    return { x: pair[0], y: pair[1] };
  };

  const agents: AgentSpec[] = (json.agents ?? []).map((a, i) => ({
    id: a.id || `a${i}`,
    start: toCell(a.start, `agents[${i}].start`),
    ...(a.goal ? { goal: toCell(a.goal, `agents[${i}].goal`) } : {}),
    colorIndex: a.colorIndex ?? i,
  }));

  const tasks: TaskSpec[] = (json.tasks ?? []).map((t, i) => ({
    id: t.id || `t${i}`,
    pickup: toCell(t.pickup, `tasks[${i}].pickup`),
    delivery: toCell(t.delivery, `tasks[${i}].delivery`),
    releaseTime: t.releaseTime ?? 0,
  }));

  return {
    id: json.id ?? "imported",
    name: json.name ?? "読み込んだシナリオ",
    kind: json.kind ?? "one-shot-mapf",
    map,
    agents,
    ...(tasks.length > 0 ? { tasks } : {}),
    rules: { ...DEFAULT_RULES, ...(json.rules ?? {}) },
    seed: json.seed ?? 1,
    ...(json.attribution ? { attribution: json.attribution } : {}),
  };
}

// ---------------------------------------------------------------- プリセット

export interface PresetDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  build(seed: number): Scenario;
}

function agentsFrom(pairs: readonly [Cell, Cell][]): AgentSpec[] {
  return pairs.map(([start, goal], i) => ({ id: `a${i + 1}`, start, goal, colorIndex: i }));
}

function baseScenario(
  id: string,
  name: string,
  map: GridMap,
  agents: AgentSpec[],
  seed: number,
  rules: SimulationRules = DEFAULT_RULES,
): Scenario {
  return { id, name, kind: "one-shot-mapf", map, agents, rules, seed };
}

function blockRect(map: GridMap, x0: number, y0: number, x1: number, y1: number): GridMap {
  let next = map;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      next = withBlocked(next, { x, y }, true);
    }
  }
  return next;
}

export const PRESETS: readonly PresetDefinition[] = [
  {
    id: "open-grid",
    name: "Open Grid",
    description: "壁のない 12×12。基本動作の確認用。",
    build: (seed) =>
      baseScenario(
        "open-grid",
        "Open Grid",
        createEmptyMap(12, 12),
        agentsFrom([
          [
            { x: 0, y: 0 },
            { x: 11, y: 11 },
          ],
          [
            { x: 11, y: 0 },
            { x: 0, y: 11 },
          ],
          [
            { x: 0, y: 11 },
            { x: 11, y: 0 },
          ],
          [
            { x: 11, y: 11 },
            { x: 0, y: 0 },
          ],
        ]),
        seed,
      ),
  },
  {
    id: "narrow-corridor",
    name: "Narrow Corridor",
    description: "幅 1 の通路。正面衝突が必ず起きる。回廊対称性の説明に使う。",
    build: (seed) => {
      let map = createEmptyMap(13, 5);
      map = blockRect(map, 0, 0, 12, 1);
      map = blockRect(map, 0, 3, 12, 4);
      map = withBlocked(map, { x: 0, y: 0 }, false);
      map = withBlocked(map, { x: 0, y: 1 }, false);
      map = withBlocked(map, { x: 12, y: 3 }, false);
      map = withBlocked(map, { x: 12, y: 4 }, false);
      return baseScenario(
        "narrow-corridor",
        "Narrow Corridor",
        map,
        agentsFrom([
          [
            { x: 0, y: 2 },
            { x: 12, y: 2 },
          ],
          [
            { x: 12, y: 2 },
            { x: 0, y: 2 },
          ],
        ]),
        seed,
      );
    },
  },
  {
    id: "rooms",
    name: "Rooms",
    description: "4 部屋を狭い出入口でつないだ配置。ボトルネックが分散する。",
    build: (seed) => {
      let map = createEmptyMap(15, 15);
      map = blockRect(map, 7, 0, 7, 14);
      map = blockRect(map, 0, 7, 14, 7);
      for (const gap of [3, 11]) {
        map = withBlocked(map, { x: 7, y: gap }, false);
        map = withBlocked(map, { x: gap, y: 7 }, false);
      }
      return baseScenario(
        "rooms",
        "Rooms",
        map,
        agentsFrom([
          [
            { x: 1, y: 1 },
            { x: 13, y: 13 },
          ],
          [
            { x: 13, y: 1 },
            { x: 1, y: 13 },
          ],
          [
            { x: 1, y: 13 },
            { x: 13, y: 1 },
          ],
          [
            { x: 13, y: 13 },
            { x: 1, y: 1 },
          ],
        ]),
        seed,
      );
    },
  },
  {
    id: "cross",
    name: "Cross",
    description: "十字路。中央で 4 方向が競合する。",
    build: (seed) => {
      let map = createEmptyMap(11, 11);
      map = blockRect(map, 0, 0, 4, 4);
      map = blockRect(map, 6, 0, 10, 4);
      map = blockRect(map, 0, 6, 4, 10);
      map = blockRect(map, 6, 6, 10, 10);
      return baseScenario(
        "cross",
        "Cross",
        map,
        agentsFrom([
          [
            { x: 5, y: 0 },
            { x: 5, y: 10 },
          ],
          [
            { x: 5, y: 10 },
            { x: 5, y: 0 },
          ],
          [
            { x: 0, y: 5 },
            { x: 10, y: 5 },
          ],
          [
            { x: 10, y: 5 },
            { x: 0, y: 5 },
          ],
        ]),
        seed,
      );
    },
  },
  {
    id: "warehouse",
    name: "Warehouse",
    description: "棚を並べた倉庫風。MAPD の説明に使う想定の骨格。",
    build: (seed) => {
      let map = createEmptyMap(21, 13);
      for (let bx = 2; bx <= 18; bx += 4) {
        for (let by = 2; by <= 10; by += 4) {
          map = blockRect(map, bx, by, bx + 1, by + 2);
        }
      }
      return baseScenario(
        "warehouse",
        "Warehouse",
        map,
        // ★ 棚は x が 2-3, 6-7, 10-11, 14-15, 18-19 の列を占める。
        //   通路は x = 0,1,4,5,8,9,12,13,16,17,20。
        //   縦移動する組は必ず通路の列に置くこと（x=10 は棚の上になる）。
        agentsFrom([
          [
            { x: 0, y: 0 },
            { x: 20, y: 12 },
          ],
          [
            { x: 20, y: 0 },
            { x: 0, y: 12 },
          ],
          [
            { x: 0, y: 6 },
            { x: 20, y: 6 },
          ],
          [
            { x: 20, y: 6 },
            { x: 0, y: 6 },
          ],
          [
            { x: 9, y: 0 },
            { x: 9, y: 12 },
          ],
          [
            { x: 9, y: 12 },
            { x: 9, y: 0 },
          ],
        ]),
        seed,
      );
    },
  },
  {
    id: "random-obstacles",
    name: "Random Obstacles",
    description: "seed で決まるランダム障害物。同じ seed なら同じ配置になる。",
    build: (seed) => {
      const random = createRandom(seed);
      let map = createEmptyMap(16, 16);
      const cells = map.width * map.height;
      const walls = Math.floor(cells * 0.18);
      for (let i = 0; i < walls; i += 1) {
        const x = randomInt(random, map.width);
        const y = randomInt(random, map.height);
        map = withBlocked(map, { x, y }, true);
      }
      // 端の 4 隅は必ず空けて、開始・目標が壁に埋まらないようにする。
      const corners: Cell[] = [
        { x: 0, y: 0 },
        { x: 15, y: 0 },
        { x: 0, y: 15 },
        { x: 15, y: 15 },
      ];
      for (const c of corners) map = withBlocked(map, c, false);
      return baseScenario(
        "random-obstacles",
        "Random Obstacles",
        map,
        agentsFrom([
          [corners[0]!, corners[3]!],
          [corners[3]!, corners[0]!],
          [corners[1]!, corners[2]!],
          [corners[2]!, corners[1]!],
        ]),
        seed,
      );
    },
  },
  {
    id: "swap-conflict",
    name: "Swap Conflict",
    description:
      "1 本道で 2 体が入れ替わる最小例。退避用のくぼみが 1 つだけある。個別に計画すると edge-swap conflict が起きるが、待避すれば解ける。",
    build: (seed) => {
      // 幅 1 の通路（y=1）と、退避用のくぼみ (3,0) だけを通行可にする。
      //
      // ★ くぼみの位置は意図的に a2 側（x=3）に寄せてある。
      //   中央（x=2）に置くと、先に計画される a1 が直進した時点で
      //   a2 がくぼみへ入る余裕を失い、固定優先順位では解けなくなる。
      //   くぼみが無ければ入れ替えは物理的に不可能で、どの手法でも解けない。
      let map = createEmptyMap(5, 3);
      map = blockRect(map, 0, 0, 4, 2);
      for (let x = 0; x < 5; x += 1) map = withBlocked(map, { x, y: 1 }, false);
      map = withBlocked(map, { x: 3, y: 0 }, false);
      return baseScenario(
        "swap-conflict",
        "Swap Conflict",
        map,
        agentsFrom([
          [
            { x: 0, y: 1 },
            { x: 4, y: 1 },
          ],
          [
            { x: 4, y: 1 },
            { x: 0, y: 1 },
          ],
        ]),
        seed,
      );
    },
  },
  {
    id: "bottleneck",
    name: "Bottleneck",
    description: "1 マスの隘路を多数のエージェントが通る。優先順位の影響が見える。",
    build: (seed) => {
      let map = createEmptyMap(13, 9);
      map = blockRect(map, 6, 0, 6, 8);
      map = withBlocked(map, { x: 6, y: 4 }, false);
      return baseScenario(
        "bottleneck",
        "Bottleneck",
        map,
        agentsFrom([
          [
            { x: 0, y: 1 },
            { x: 12, y: 1 },
          ],
          [
            { x: 0, y: 3 },
            { x: 12, y: 3 },
          ],
          [
            { x: 0, y: 5 },
            { x: 12, y: 5 },
          ],
          [
            { x: 0, y: 7 },
            { x: 12, y: 7 },
          ],
        ]),
        seed,
      );
    },
  },
];

export function getPreset(id: string): PresetDefinition | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function buildPreset(id: string, seed: number): Scenario {
  const preset = getPreset(id);
  if (!preset) throw new ScenarioParseError(`未知のプリセット: ${id}`);
  return preset.build(seed);
}

/** 開始・目標が壁の上に無いかなど、実行前の最低限の検証。 */
export function validateScenario(scenario: Scenario): string[] {
  const problems: string[] = [];
  const seenStart = new Set<string>();
  for (const agent of scenario.agents) {
    if (!isWalkable(scenario.map, agent.start)) {
      problems.push(`${agent.id}: 開始位置が壁または範囲外です`);
    }
    if (agent.goal && !isWalkable(scenario.map, agent.goal)) {
      problems.push(`${agent.id}: 目標位置が壁または範囲外です`);
    }
    const key = `${agent.start.x},${agent.start.y}`;
    if (seenStart.has(key))
      problems.push(`${agent.id}: 開始位置が他のエージェントと重複しています`);
    seenStart.add(key);
  }
  if (scenario.kind === "one-shot-mapf") {
    const missing = scenario.agents.filter((a) => !a.goal);
    if (missing.length > 0) {
      problems.push(`目標が未設定のエージェントがあります: ${missing.map((a) => a.id).join(", ")}`);
    }
  }
  return problems;
}
