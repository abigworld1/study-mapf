import { describe, expect, it } from "vitest";
import {
  ScenarioParseError,
  buildPreset,
  scenarioFromJson,
  scenarioToJson,
  validateScenario,
} from "@/lib/model/scenario";
import { parseMovingAiMap, parseMovingAiScen, scenarioFromMovingAi } from "@/lib/model/movingai";
import { isBlocked } from "@/lib/model/grid";
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
