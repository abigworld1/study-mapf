import { describe, expect, it } from "vitest";
import type { Scenario } from "@/lib/model/types";
import { DEFAULT_RULES } from "@/lib/model/types";
import { createEmptyMap, withBlocked } from "@/lib/model/grid";
import { buildPreset, validateScenario } from "@/lib/model/scenario";
import {
  canPaintWall,
  describeDragTarget,
  dragTargetCell,
  findDragTarget,
  moveDragTarget,
} from "@/components/simulator/drag";

function oneShot(): Scenario {
  return {
    id: "s",
    name: "s",
    kind: "one-shot-mapf",
    map: withBlocked(createEmptyMap(6, 4), { x: 3, y: 1 }, true),
    agents: [
      { id: "a1", start: { x: 0, y: 0 }, goal: { x: 5, y: 3 } },
      { id: "a2", start: { x: 0, y: 3 }, goal: { x: 5, y: 0 } },
    ],
    rules: DEFAULT_RULES,
    seed: 1,
  };
}

describe("掴めるものの判定", () => {
  it("開始位置・目標・タスク地点・チーム target を掴める", () => {
    const s = oneShot();
    expect(findDragTarget(s, { x: 0, y: 0 })).toEqual({ kind: "agent-start", agentId: "a1" });
    expect(findDragTarget(s, { x: 5, y: 3 })).toEqual({ kind: "agent-goal", agentId: "a1" });
    expect(findDragTarget(s, { x: 2, y: 2 })).toBeNull();

    const mapd = buildPreset("mapd-well-formed", 1);
    const task = mapd.tasks![0]!;
    expect(findDragTarget(mapd, task.pickup)).toEqual({ kind: "task-pickup", taskId: task.id });
    expect(findDragTarget(mapd, task.delivery)).toEqual({ kind: "task-delivery", taskId: task.id });

    const tapf = buildPreset("tapf-two-teams", 1);
    const team = tapf.teams![0]!;
    expect(findDragTarget(tapf, team.goals[1]!)).toEqual({
      kind: "team-target",
      teamId: team.id,
      index: 1,
    });
  });

  /*
    ★ 重なったときは手前のものから。奥のものを掴みたければ
      手前のものを先にどければよい、という前提の順序。
  */
  it("同じセルに重なっていたらエージェント本体が優先される", () => {
    const s: Scenario = {
      ...oneShot(),
      agents: [{ id: "a1", start: { x: 2, y: 2 }, goal: { x: 2, y: 2 } }],
    };
    expect(findDragTarget(s, { x: 2, y: 2 })).toEqual({ kind: "agent-start", agentId: "a1" });
  });

  it("掴んでいるものの現在位置を返す", () => {
    const s = oneShot();
    expect(dragTargetCell(s, { kind: "agent-goal", agentId: "a2" })).toEqual({ x: 5, y: 0 });
    expect(dragTargetCell(s, { kind: "agent-start", agentId: "missing" })).toBeNull();
  });

  it("説明文が出る", () => {
    expect(describeDragTarget({ kind: "agent-start", agentId: "a1" })).toContain("a1");
    expect(describeDragTarget({ kind: "task-pickup", taskId: "t1" })).toContain("pickup");
  });
});

describe("置けるかどうかの判定", () => {
  it("壁の上には置けない", () => {
    const s = oneShot();
    expect(moveDragTarget(s, { kind: "agent-start", agentId: "a1" }, { x: 3, y: 1 })).toBeNull();
    expect(moveDragTarget(s, { kind: "agent-goal", agentId: "a1" }, { x: 3, y: 1 })).toBeNull();
  });

  /*
    ★ 開始位置を重ねられないのはモデル側の制約。同時刻に同じセルは
      vertex conflict になるので、初期配置の時点で重ねてはいけない。
  */
  it("他のエージェントの開始位置には置けない", () => {
    const s = oneShot();
    expect(moveDragTarget(s, { kind: "agent-start", agentId: "a1" }, { x: 0, y: 3 })).toBeNull();
  });

  it("動かした結果が妥当なシナリオになる", () => {
    const s = oneShot();
    const moved = moveDragTarget(s, { kind: "agent-start", agentId: "a1" }, { x: 2, y: 2 });
    expect(moved).not.toBeNull();
    expect(moved!.agents[0]!.start).toEqual({ x: 2, y: 2 });
    // 他のエージェントは動かない。
    expect(moved!.agents[1]).toEqual(s.agents[1]);
    expect(validateScenario(moved!)).toEqual([]);
  });

  it("同じセルへ置き直しても壊れない", () => {
    const s = oneShot();
    expect(moveDragTarget(s, { kind: "agent-start", agentId: "a1" }, { x: 0, y: 0 })).toBe(s);
  });

  /*
    ★ TAPF の target は重複できない。cbm-tapf-aamas-2016 p.2 が
      unique targets と定義しており、validateScenario も同じ条件を見ている。
      ドラッグでそこを破れてしまうと、掴んで動かしただけで
      検証を通らない盤面ができる。
  */
  it("TAPF の target は他の target へ重ねられない", () => {
    const tapf = buildPreset("tapf-two-teams", 1);
    const team = tapf.teams![0]!;
    const other = tapf.teams![1]!.goals[0]!;
    expect(
      moveDragTarget(tapf, { kind: "team-target", teamId: team.id, index: 0 }, other),
    ).toBeNull();

    const free = { x: 3, y: 1 };
    const moved = moveDragTarget(tapf, { kind: "team-target", teamId: team.id, index: 0 }, free);
    expect(moved).not.toBeNull();
    expect(moved!.teams![0]!.goals[0]).toEqual(free);
    expect(validateScenario(moved!)).toEqual([]);
  });

  /*
    ★ タスク地点は重なってよい。論文側に禁止は無く、実際
      mapd-parking プリセットは 2 つのタスクの delivery が同じセルにある。
  */
  it("タスクの delivery は重ねられる", () => {
    const mapd = buildPreset("mapd-well-formed", 1);
    const first = mapd.tasks![0]!;
    const second = mapd.tasks![1]!;
    const moved = moveDragTarget(
      mapd,
      { kind: "task-delivery", taskId: second.id },
      first.delivery,
    );
    expect(moved).not.toBeNull();
    expect(moved!.tasks![1]!.delivery).toEqual(first.delivery);
  });
});

describe("壁を塗れるセル", () => {
  it("何かが乗っているセルは塗らない", () => {
    const s = oneShot();
    expect(canPaintWall(s, { x: 2, y: 2 })).toBe(true);
    // 開始位置と目標の上は塗らない。塗ると壁の下に隠れてしまう。
    expect(canPaintWall(s, { x: 0, y: 0 })).toBe(false);
    expect(canPaintWall(s, { x: 5, y: 3 })).toBe(false);
  });

  it("全プリセットで、掴めるセルは壁塗りの対象にならない", () => {
    for (const id of ["open-grid", "warehouse", "tapf-two-teams", "mapd-well-formed"]) {
      const s = buildPreset(id, 1);
      for (let y = 0; y < s.map.height; y += 1) {
        for (let x = 0; x < s.map.width; x += 1) {
          const cell = { x, y };
          const hasItem = findDragTarget(s, cell) !== null;
          expect(canPaintWall(s, cell), `${id} (${x},${y})`).toBe(!hasItem);
        }
      }
    }
  });
});
