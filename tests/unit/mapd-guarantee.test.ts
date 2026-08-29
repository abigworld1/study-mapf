import { describe, expect, it } from "vitest";
import type { Scenario, TaskSpec } from "@/lib/model/types";
import { DEFAULT_RULES, DEFAULT_SOLVER_OPTIONS } from "@/lib/model/types";
import { createEmptyMap, isWalkable, withBlocked } from "@/lib/model/grid";
import { checkWellFormed } from "@/lib/model/mapd";
import { createRandom, randomInt } from "@/lib/model/random";
import { createRecordingContext } from "@/solvers/context";
import { getSolver } from "@/solvers/registry";
import { detectConflicts } from "@/lib/model/conflicts";

/**
 * MAPD の保証を、決め打ちのプリセットではなくランダムな well-formed 入力で確かめる。
 *
 * ★ プリセットだけで見ていたので取りこぼしていた。
 *   TP は well-formed な入力を必ず解けるはず（mapd-tp-tpts-central-2017
 *   p.4 Theorem 3）なのに、実際には 2 割弱で詰んでいた。
 *   4 つのプリセットは全部通っていたので気付けなかった。
 */

/** 通路 y=0,2,4 と alcove 列の倉庫風マップ。endpoint は alcove だけに置く。 */
function randomWarehouse(seed: number): Scenario {
  const rnd = createRandom(seed);
  const width = 13;
  let map = createEmptyMap(width, 5);
  for (const y of [1, 3]) {
    for (let x = 0; x < width; x += 1) if (x % 2 === 1) map = withBlocked(map, { x, y }, true);
  }
  const alcove: { x: number; y: number }[] = [];
  for (const y of [1, 3]) for (let x = 0; x < width; x += 2) alcove.push({ x, y });
  const agents = [0, 1, 2].map((i) => ({ id: `a${i + 1}`, start: { x: i * 4, y: 2 } }));
  const starts = new Set(agents.map((a) => `${a.start.x},${a.start.y}`));
  const work = alcove.filter((c) => !starts.has(`${c.x},${c.y}`) && isWalkable(map, c));
  const count = 2 + randomInt(rnd, 3);
  const tasks: TaskSpec[] = Array.from({ length: count }, (_, i) => ({
    id: `t${i + 1}`,
    pickup: work[randomInt(rnd, work.length)]!,
    delivery: work[randomInt(rnd, work.length)]!,
    releaseTime: randomInt(rnd, 6),
  }));
  return {
    id: `w${seed}`,
    name: `w${seed}`,
    kind: "mapd",
    map,
    agents,
    tasks,
    parkingEndpoints: agents.map((a) => ({ ...a.start })),
    rules: DEFAULT_RULES,
    seed,
  };
}

function wellFormedSamples(limit: number): Scenario[] {
  const out: Scenario[] = [];
  for (let seed = 1; out.length < limit && seed <= 200; seed += 1) {
    const scenario = randomWarehouse(seed);
    const verdict = checkWellFormed(scenario);
    if (verdict.checked && verdict.wellFormed) out.push(scenario);
  }
  return out;
}

async function solve(id: string, scenario: Scenario) {
  const recording = createRecordingContext(scenario.seed);
  return getSolver(id)!.solve(scenario, DEFAULT_SOLVER_OPTIONS, recording.context);
}

const SAMPLES = wellFormedSamples(30);

describe("well-formed な入力に対する MAPD の保証", () => {
  it("十分な数の well-formed な例を用意できている", () => {
    expect(SAMPLES.length).toBe(30);
  });

  /*
    ★ 完全性を主張する手法は、well-formed な入力を必ず解ききること。

      TP: 同 p.4 Theorem 3「All well-formed MAPD instances are solvable,
          and TP solves them.」
      TPTS: 同 p.5 Theorem 5「TPTS solves all well-formed MAPD instances.」
      LNS-PBS: mg-mapd-iros-2022 p.5 Theorem 1

      CENTRAL は保証を持たない（mapd-tp-tpts-central-2017 p.5 §5）が、
      実装上はこの規模なら解けているので一緒に見る。落ちたら
      「保証が無いから当然」ではなく、まず実装を疑うこと。
  */
  it.each(["token-passing", "tpts", "central", "lns-pbs"])(
    "%s は well-formed な入力を解ききる",
    async (id) => {
      const failures: string[] = [];
      for (const scenario of SAMPLES) {
        const result = await solve(id, scenario);
        if (result.outcome !== "solved" || result.metrics.pendingTasks !== 0) {
          failures.push(`${scenario.id}: ${result.outcome} 未処理=${result.metrics.pendingTasks}`);
        }
      }
      expect(failures, failures.join(" / ")).toEqual([]);
    },
  );

  /*
    ★ solved を名乗るなら衝突は 0。
      TPTS は task を奪ったとき、奪われた側を token から消したままにしていて、
      後から計画する agent がその居場所を通る経路を引いていた。
      「解が求まりました」と出しながら重なっている状態だった。
  */
  it.each(["mapd-greedy", "token-passing", "tpts", "central", "lns-pbs", "lns-wpbs", "rmca"])(
    "%s は solved を返したとき衝突を残さない",
    async (id) => {
      const bad: string[] = [];
      for (const scenario of SAMPLES) {
        const result = await solve(id, scenario);
        if (result.outcome !== "solved") continue;
        const conflicts = detectConflicts(result.paths, scenario.rules);
        if (conflicts.length > 0) bad.push(`${scenario.id}: ${conflicts.length} 件`);
      }
      expect(bad, bad.join(" / ")).toEqual([]);
    },
  );
});

describe("配達地点が次のタスクの pickup と同じ場合", () => {
  /*
    ★ これが TP の詰みの正体だった。

      配達を終えた地点が、次に割り当てられたタスクの pickup と同じだと、
      エージェントは次の step でそこを離れる。pickup / delivery の判定は
      移動のあとにしか走らないので pickup が記録されず、pickedUp=false の
      まま delivery に着いても配達が成立しない。そのタスクを抱えたまま
      delivery 上に居座り、他のエージェントも取れなくなる。
  */
  it("その場で pickup を拾い、最後まで配達できる", async () => {
    const width = 9;
    let map = createEmptyMap(width, 3);
    for (const y of [0, 2]) {
      for (let x = 0; x < width; x += 1) if (x % 2 === 1) map = withBlocked(map, { x, y }, true);
    }
    // t1 の delivery と t2 の pickup を同じ (4,0) にする。
    const scenario: Scenario = {
      id: "chain",
      name: "chain",
      kind: "mapd",
      map,
      agents: [{ id: "a1", start: { x: 0, y: 1 } }],
      tasks: [
        { id: "t1", pickup: { x: 2, y: 0 }, delivery: { x: 4, y: 0 }, releaseTime: 0 },
        { id: "t2", pickup: { x: 4, y: 0 }, delivery: { x: 8, y: 0 }, releaseTime: 0 },
      ],
      parkingEndpoints: [{ x: 0, y: 1 }],
      rules: DEFAULT_RULES,
      seed: 1,
    };

    for (const id of ["mapd-greedy", "token-passing", "tpts", "central"]) {
      const recording = createRecordingContext(1);
      const result = await getSolver(id)!.solve(
        scenario,
        DEFAULT_SOLVER_OPTIONS,
        recording.context,
      );
      expect(result.outcome, id).toBe("solved");
      expect(result.metrics.pendingTasks, id).toBe(0);
      // 2 件とも pickup と delivery が 1 回ずつ記録されること。
      const kinds = recording.events.filter((e) => e.type === "pickup" || e.type === "delivery");
      expect(
        kinds.filter((e) => e.type === "pickup"),
        id,
      ).toHaveLength(2);
      expect(
        kinds.filter((e) => e.type === "delivery"),
        id,
      ).toHaveLength(2);
    }
  });
});
