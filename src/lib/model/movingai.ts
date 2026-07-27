import type { AgentSpec, GridMap, Scenario } from "./types.js";
import { DEFAULT_RULES } from "./types.js";
import { ScenarioParseError } from "./scenario.js";

/**
 * Moving AI の .map / .scen を読む。
 *
 * ★ ベンチマーク本体はリポジトリへ同梱しない（サイズと配布条件のため）。
 *   利用者が手元のファイルを読み込む用途を想定している。
 *   配布元: https://movingai.com/benchmarks/mapf.html
 *
 * .map の書式:
 *   type octile
 *   height H
 *   width W
 *   map
 *   （以降 H 行。'.' 'G' 'S' が通行可、'@' 'O' 'T' 'W' が通行不可）
 */
const PASSABLE = new Set([".", "G", "S"]);

export function parseMovingAiMap(text: string, source?: string): GridMap {
  const lines = text.split(/\r?\n/);
  let height = 0;
  let width = 0;
  let mapStart = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (line.startsWith("height")) height = Number.parseInt(line.split(/\s+/)[1] ?? "", 10);
    else if (line.startsWith("width")) width = Number.parseInt(line.split(/\s+/)[1] ?? "", 10);
    else if (line === "map") {
      mapStart = i + 1;
      break;
    }
  }

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new ScenarioParseError("Moving AI .map: width / height を読み取れませんでした");
  }
  if (mapStart < 0) {
    throw new ScenarioParseError("Moving AI .map: 'map' 行が見つかりませんでした");
  }

  const blocked = new Array<boolean>(width * height).fill(true);
  for (let y = 0; y < height; y += 1) {
    const row = lines[mapStart + y];
    if (row === undefined) {
      throw new ScenarioParseError(`Moving AI .map: ${y} 行目が不足しています`);
    }
    for (let x = 0; x < width; x += 1) {
      blocked[y * width + x] = !PASSABLE.has(row[x] ?? "@");
    }
  }
  return { width, height, blocked, ...(source ? { source } : {}) };
}

export interface ScenEntry {
  readonly bucket: number;
  readonly mapName: string;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly startX: number;
  readonly startY: number;
  readonly goalX: number;
  readonly goalY: number;
  readonly optimalLength: number;
}

/**
 * .scen の書式（version 1）:
 *   version 1
 *   bucket  map  width  height  sx  sy  gx  gy  optimal
 *
 * ★ Moving AI の座標は (col, row) = (x, y)。本サイトの Cell と同じ並びなので変換不要。
 */
export function parseMovingAiScen(text: string): ScenEntry[] {
  const out: ScenEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("version")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;
    const num = (i: number) => Number.parseFloat(parts[i] ?? "");
    const entry: ScenEntry = {
      bucket: num(0),
      mapName: parts[1] ?? "",
      mapWidth: num(2),
      mapHeight: num(3),
      startX: num(4),
      startY: num(5),
      goalX: num(6),
      goalY: num(7),
      optimalLength: num(8),
    };
    if (Number.isNaN(entry.startX) || Number.isNaN(entry.goalY)) continue;
    out.push(entry);
  }
  if (out.length === 0) {
    throw new ScenarioParseError("Moving AI .scen: 有効な行がありませんでした");
  }
  return out;
}

/**
 * .map と .scen から Scenario を組み立てる。
 * agentCount で先頭 n 件だけ使う（ベンチマークは 1000 件入っていることがある）。
 */
export function scenarioFromMovingAi(
  map: GridMap,
  entries: readonly ScenEntry[],
  agentCount: number,
  seed = 1,
  name = "Moving AI シナリオ",
): Scenario {
  const used = entries.slice(0, Math.max(0, agentCount));
  const agents: AgentSpec[] = used.map((e, i) => ({
    id: `a${i + 1}`,
    start: { x: e.startX, y: e.startY },
    goal: { x: e.goalX, y: e.goalY },
    colorIndex: i,
  }));
  return {
    id: "movingai",
    name,
    kind: "one-shot-mapf",
    map,
    agents,
    rules: DEFAULT_RULES,
    seed,
    attribution:
      "Moving AI Lab の MAPF ベンチマーク（https://movingai.com/benchmarks/mapf.html）。マップとシナリオの著作権は配布元に帰属する。",
  };
}
