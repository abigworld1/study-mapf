import { describe, expect, it } from "vitest";
import { buildPreset } from "@/lib/model/scenario";
import { runInline } from "@/solvers/client";
import { HERO_PRESET_ID, HERO_SEED } from "@/components/HeroDemo";

/*
  ★ トップページのデモは「解けること」が前提。
    HeroDemo は makespan からアニメーションの周期を作るので、
    解けないプリセットを指すと makespan が 0 になり、
    setInterval が起動せず静止画になる。
    実際に cross（壁 83%、固定優先順位では解けない）を指していて、
    トップページが真っ黒な静止画のままだった。
*/
describe("トップページのデモ", () => {
  it("使用するプリセットが優先順位付き計画で解ける", async () => {
    const scenario = buildPreset(HERO_PRESET_ID, HERO_SEED);
    const result = await runInline({ solverId: "prioritized-planning", scenario });
    expect(result.outcome, `${HERO_PRESET_ID} が解けない。デモが静止画になる`).toBe("solved");
    expect(result.metrics.makespan, "makespan 0 ではアニメーションが動かない").toBeGreaterThan(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it("盤面が壁で埋まっていない", () => {
    const { map } = buildPreset(HERO_PRESET_ID, HERO_SEED);
    const cells = map.width * map.height;
    const walls = map.blocked.filter(Boolean).length;
    // 壁が過半を占めると、縮小表示のトップページではただの黒い矩形に見える。
    expect(walls / cells, `壁が ${Math.round((walls / cells) * 100)}%`).toBeLessThan(0.4);
  });

  it("動きが見える程度にエージェントがいる", () => {
    const { agents } = buildPreset(HERO_PRESET_ID, HERO_SEED);
    expect(agents.length).toBeGreaterThanOrEqual(3);
  });
});
