import { describe, expect, it } from "vitest";
import type { Scenario } from "@/lib/model/types";
import { DEFAULT_RULES, DEFAULT_SOLVER_OPTIONS } from "@/lib/model/types";
import {
  PRESETS,
  ScenarioParseError,
  buildPreset,
  scenarioFromJson,
  scenarioToJson,
  validateScenario,
} from "@/lib/model/scenario";
import { parseMovingAiMap, parseMovingAiScen, scenarioFromMovingAi } from "@/lib/model/movingai";
import { createEmptyMap, isBlocked, withBlocked } from "@/lib/model/grid";
import { checkWellFormed } from "@/lib/model/mapd";
import { detectConflicts } from "@/lib/model/conflicts";
import { createSolverContext } from "@/solvers/context";
import { getSolver, listSolverMetadataFor } from "@/solvers/registry";
import { createRandom, shuffleInPlace } from "@/lib/model/random";

describe("シナリオ JSON", () => {
  it("往復して同じ内容になる", () => {
    const original = buildPreset("rooms", 9);
    const restored = scenarioFromJson(JSON.parse(JSON.stringify(scenarioToJson(original))));
    expect(restored.map.width).toBe(original.map.width);
    expect(restored.map.height).toBe(original.map.height);
    expect(restored.map.blocked).toEqual(original.map.blocked);
    expect(restored.agents.map((a) => a.id)).toEqual(original.agents.map((a) => a.id));
    expect(restored.rules).toEqual(original.rules);
    expect(restored.seed).toBe(original.seed);
  });

  it("formatVersion が違えば拒否する", () => {
    expect(() => scenarioFromJson({ formatVersion: 2 })).toThrow(ScenarioParseError);
  });

  it("map の行数が height と合わなければ拒否する", () => {
    expect(() =>
      scenarioFromJson({ formatVersion: 1, width: 2, height: 2, map: ["..'"], agents: [] }),
    ).toThrow(ScenarioParseError);
  });

  it("オブジェクトでなければ拒否する", () => {
    expect(() => scenarioFromJson(null)).toThrow(ScenarioParseError);
    expect(() => scenarioFromJson("x")).toThrow(ScenarioParseError);
  });

  it("MAPD タスクも往復できる", () => {
    const base = buildPreset("open-grid", 1);
    const withTasks = {
      ...base,
      kind: "mapd" as const,
      tasks: [{ id: "t1", pickup: { x: 1, y: 1 }, delivery: { x: 5, y: 5 }, releaseTime: 3 }],
    };
    const restored = scenarioFromJson(JSON.parse(JSON.stringify(scenarioToJson(withTasks))));
    expect(restored.tasks).toHaveLength(1);
    expect(restored.tasks![0]!.releaseTime).toBe(3);
  });
});

describe("シナリオ検証", () => {
  it("壁の上の開始位置を検出する", () => {
    const base = buildPreset("open-grid", 1);
    const broken = {
      ...base,
      map: { ...base.map, blocked: base.map.blocked.map((_, i) => i === 0) },
    };
    expect(validateScenario(broken).length).toBeGreaterThan(0);
  });

  it("開始位置の重複を検出する", () => {
    const base = buildPreset("open-grid", 1);
    const first = base.agents[0]!;
    const broken = {
      ...base,
      agents: [first, { ...base.agents[1]!, start: first.start }],
    };
    expect(validateScenario(broken).some((m) => m.includes("重複"))).toBe(true);
  });
});

describe("Moving AI パーサ", () => {
  const mapText = `type octile
height 3
width 4
map
....
.@@.
....
`;

  it(".map を読める", () => {
    const map = parseMovingAiMap(mapText, "test.map");
    expect(map.width).toBe(4);
    expect(map.height).toBe(3);
    expect(isBlocked(map, { x: 1, y: 1 })).toBe(true);
    expect(isBlocked(map, { x: 0, y: 1 })).toBe(false);
    expect(map.source).toBe("test.map");
  });

  it("height / width が無ければ拒否する", () => {
    expect(() => parseMovingAiMap("type octile\nmap\n....")).toThrow();
  });

  it("map 行が足りなければ拒否する", () => {
    expect(() => parseMovingAiMap("height 3\nwidth 4\nmap\n....\n")).toThrow();
  });

  it(".scen を読める", () => {
    const scen = `version 1
0\ttest.map\t4\t3\t0\t0\t3\t2\t5
1\ttest.map\t4\t3\t3\t0\t0\t2\t5
`;
    const entries = parseMovingAiScen(scen);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.startX).toBe(0);
    expect(entries[0]!.goalY).toBe(2);
    expect(entries[1]!.mapName).toBe("test.map");
  });

  it("有効な行が無ければ拒否する", () => {
    expect(() => parseMovingAiScen("version 1\n")).toThrow();
  });

  it(".map と .scen からシナリオを組み立てられる", () => {
    const map = parseMovingAiMap(mapText);
    const entries = parseMovingAiScen(
      "version 1\n0\ttest.map\t4\t3\t0\t0\t3\t2\t5\n1\ttest.map\t4\t3\t3\t0\t0\t2\t5\n",
    );
    const scenario = scenarioFromMovingAi(map, entries, 1);
    expect(scenario.agents).toHaveLength(1);
    expect(scenario.attribution).toContain("Moving AI");
  });
});

describe("乱数", () => {
  it("同じ seed なら同じ列", () => {
    const a = createRandom(123);
    const b = createRandom(123);
    for (let i = 0; i < 20; i += 1) expect(a()).toBe(b());
  });

  it("違う seed なら違う列", () => {
    const a = createRandom(1);
    const b = createRandom(2);
    expect(a()).not.toBe(b());
  });

  it("shuffle も seed で決まる", () => {
    const a = shuffleInPlace([1, 2, 3, 4, 5, 6, 7, 8], createRandom(9));
    const b = shuffleInPlace([1, 2, 3, 4, 5, 6, 7, 8], createRandom(9));
    expect(a).toEqual(b);
  });

  it("random() は 0 以上 1 未満", () => {
    const r = createRandom(7);
    for (let i = 0; i < 200; i += 1) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("JSON の往復で情報が落ちないこと", () => {
  /*
    ★ 書き出して読み込むだけで消える項目があった。

      parkingEndpoints は ScenarioJson にフィールドが無く、
      scenarioToJson が出力していなかった。MAPD の non-task endpoint は
      well-formed 条件 (b)（mapd-tp-tpts-central-2017 p.2 Definition 1）に
      効くので、落ちると well-formed だった入力が well-formed でなくなる。
      画面はその判定を出しているので、往復しただけで表示が反転していた。

      lifelong の goal 列も同じで、型にも JSON にも無く、実装だけが
      キャストで読んでいた。

      プリセット個別ではなく全プリセットで見る。項目を足したときに
      入出力へ通し忘れるのを、ここで捕まえる。
  */
  it.each(PRESETS.map((preset) => preset.id))("%s は往復しても同じ", (id) => {
    const original = buildPreset(id, 1);
    const restored = scenarioFromJson(JSON.parse(JSON.stringify(scenarioToJson(original))));

    expect(restored.kind).toBe(original.kind);
    expect(restored.agents).toEqual(original.agents);
    expect(restored.tasks ?? null).toEqual(original.tasks ?? null);
    expect(restored.teams ?? null).toEqual(original.teams ?? null);
    expect(restored.parkingEndpoints ?? null).toEqual(original.parkingEndpoints ?? null);
    expect(restored.goalSequences ?? null).toEqual(original.goalSequences ?? null);
    expect(restored.rules).toEqual(original.rules);
    expect(validateScenario(restored)).toEqual([]);

    const before = checkWellFormed(original);
    const after = checkWellFormed(restored);
    if (before.checked && after.checked) {
      expect(after.wellFormed, "往復で well-formed 判定が変わる").toBe(before.wellFormed);
    }
  });

  /*
    ★ parkingEndpoints が well-formed を左右する形を固定しておく。
      agent の start を作業地点に重ねると、non-task endpoint を供給するのは
      parkingEndpoints だけになる。落とすと条件 (b) が破れる。
  */
  it("parkingEndpoints だけが non-task endpoint を supply する場合も往復する", () => {
    let map = createEmptyMap(9, 3);
    for (const y of [0, 2])
      for (let x = 0; x < 9; x += 1) if (x % 2 === 1) map = withBlocked(map, { x, y }, true);
    const scenario: Scenario = {
      id: "park",
      name: "park",
      kind: "mapd",
      map,
      agents: [
        { id: "a1", start: { x: 2, y: 0 } },
        { id: "a2", start: { x: 6, y: 0 } },
      ],
      tasks: [
        { id: "t1", pickup: { x: 2, y: 0 }, delivery: { x: 4, y: 0 }, releaseTime: 0 },
        { id: "t2", pickup: { x: 6, y: 0 }, delivery: { x: 8, y: 0 }, releaseTime: 0 },
      ],
      parkingEndpoints: [
        { x: 0, y: 2 },
        { x: 2, y: 2 },
      ],
      rules: DEFAULT_RULES,
      seed: 1,
    };
    const restored = scenarioFromJson(JSON.parse(JSON.stringify(scenarioToJson(scenario))));
    expect(restored.parkingEndpoints).toEqual(scenario.parkingEndpoints);
    expect(checkWellFormed(scenario).wellFormed).toBe(true);
    expect(checkWellFormed(restored).wellFormed).toBe(true);
  });
});

describe("lifelong MAPF", () => {
  /*
    ★ goal 列は Scenario.goalSequences に持つ。
      型・プリセット・JSON・検証のどれかが欠けると、実装だけが読める
      隠しキーに戻ってしまう。4 つとも揃っていることを見る。
  */
  it("プリセットが検証を通り、RHCR だけが候補に出る", () => {
    const scenario = buildPreset("lifelong-loop", 1);
    expect(scenario.kind).toBe("lifelong-mapf");
    expect(Object.keys(scenario.goalSequences ?? {})).toHaveLength(scenario.agents.length);
    expect(validateScenario(scenario)).toEqual([]);
    expect(listSolverMetadataFor(scenario).map((m) => m.id)).toEqual(["rhcr"]);
  });

  it("RHCR が goal 列を最後まで処理する", async () => {
    const scenario = buildPreset("lifelong-loop", 1);
    const result = await getSolver("rhcr")!.solve(
      scenario,
      DEFAULT_SOLVER_OPTIONS,
      createSolverContext({ seed: 1, signal: new AbortController().signal, emit: () => {} }),
    );
    expect(result.outcome).toBe("solved");
    expect(result.metrics.pendingTasks).toBe(0);
    expect(detectConflicts(result.paths, scenario.rules)).toEqual([]);
  }, 60_000);

  it("goal 列の不備を検証で捕まえる", () => {
    const base = buildPreset("lifelong-loop", 1);
    expect(validateScenario({ ...base, goalSequences: {} })).toContain(
      "lifelong MAPF には goalSequences が必要です",
    );
    expect(
      validateScenario({
        ...base,
        goalSequences: { ...base.goalSequences, zzz: [{ cell: { x: 0, y: 0 }, releaseTime: 0 }] },
      }),
    ).toContain("goalSequences: 未知のエージェント zzz が指定されています");
  });
});
