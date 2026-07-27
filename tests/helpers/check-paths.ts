import { positionAt } from "@/lib/model/conflicts";
import { cellEquals, isWalkable } from "@/lib/model/grid";
import type { Scenario, TimedPath } from "@/lib/model/types";

export interface Violation {
  rule: string;
  detail: string;
}

/** Solver が返した経路について、サイト共通モデルの不変条件をまとめて検査する。 */
export function checkPaths(scenario: Scenario, paths: readonly TimedPath[]): Violation[] {
  const violations: Violation[] = [];
  const rules = scenario.rules;
  const pathIds = new Set<string>();

  for (const path of paths) {
    if (pathIds.has(path.agentId)) {
      violations.push({ rule: "同じ agent の経路が重複", detail: path.agentId });
    }
    pathIds.add(path.agentId);
    const positions = path.positions;
    if (positions.length === 0) {
      violations.push({ rule: "空の経路", detail: path.agentId });
      continue;
    }

    const agent = scenario.agents.find((candidate) => candidate.id === path.agentId);
    if (agent && !cellEquals(positions[0]!.cell, agent.start)) {
      violations.push({ rule: "開始位置が違う", detail: path.agentId });
    }

    for (let i = 0; i < positions.length; i += 1) {
      const position = positions[i]!;
      if (!isWalkable(scenario.map, position.cell)) {
        violations.push({ rule: "壁を通過", detail: `${path.agentId}@t${position.time}` });
      }
      if (i > 0 && position.time !== positions[i - 1]!.time + 1) {
        violations.push({
          rule: "時刻が連続していない",
          detail: `${path.agentId}@t${position.time}`,
        });
      }
      if (i > 0) {
        const previous = positions[i - 1]!;
        const dx = Math.abs(position.cell.x - previous.cell.x);
        const dy = Math.abs(position.cell.y - previous.cell.y);
        const adjacent = rules.allowDiagonal ? dx <= 1 && dy <= 1 : dx + dy <= 1;
        if (!adjacent) {
          violations.push({
            rule: "隣接しないセルへ移動",
            detail: `${path.agentId}@t${position.time}`,
          });
        }
      }
    }

    if (agent?.goal) {
      const last = positions[positions.length - 1]!;
      if (!cellEquals(last.cell, agent.goal)) {
        violations.push({ rule: "ゴール未到達", detail: path.agentId });
      }
    }
  }

  for (const agent of scenario.agents) {
    if (!pathIds.has(agent.id)) {
      violations.push({ rule: "agent の経路が無い", detail: agent.id });
    }
  }

  const horizon = Math.max(0, ...paths.map((path) => path.positions.at(-1)?.time ?? 0));
  for (let time = 0; time <= horizon; time += 1) {
    const seen = new Map<string, string>();
    for (const path of paths) {
      const cell = positionAt(path, time, rules);
      if (!cell) continue;
      const key = `${cell.x},${cell.y}`;
      const other = seen.get(key);
      if (other) {
        violations.push({ rule: "同時刻に同じセル", detail: `${other}/${path.agentId}@t${time}` });
      }
      seen.set(key, path.agentId);
    }
    if (time === 0 || !rules.forbidEdgeSwap) continue;
    for (let i = 0; i < paths.length; i += 1) {
      for (let j = i + 1; j < paths.length; j += 1) {
        const a = paths[i]!;
        const b = paths[j]!;
        const aPrevious = positionAt(a, time - 1, rules);
        const aNow = positionAt(a, time, rules);
        const bPrevious = positionAt(b, time - 1, rules);
        const bNow = positionAt(b, time, rules);
        if (!aPrevious || !aNow || !bPrevious || !bNow) continue;
        if (
          cellEquals(aPrevious, bNow) &&
          cellEquals(aNow, bPrevious) &&
          !cellEquals(aPrevious, aNow)
        ) {
          violations.push({ rule: "edge swap", detail: `${a.agentId}/${b.agentId}@t${time}` });
        }
      }
    }
  }

  return violations;
}
