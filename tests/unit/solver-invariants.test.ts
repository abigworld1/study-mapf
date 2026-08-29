import { describe, expect, it } from "vitest";
import type { Scenario, TaskSpec } from "@/lib/model/types";
import { DEFAULT_RULES, DEFAULT_SOLVER_OPTIONS } from "@/lib/model/types";
import { createEmptyMap, isWalkable, withBlocked } from "@/lib/model/grid";
import { createRandom, randomInt } from "@/lib/model/random";
import { createSolverContext } from "@/solvers/context";
import {
  getSolver,
  listSolverMetadata,
  listSolverMetadataFor,
  solversFor,
} from "@/solvers/registry";
import { detectConflicts, makespanOf, sumOfCosts } from "@/lib/model/conflicts";
import { jointStateOptimalSumOfCosts } from "@/solvers/reference/joint-state";
import { PRESETS, buildPreset, validateScenario } from "@/lib/model/scenario";
import { checkWellFormed } from "@/lib/model/mapd";
import { checkPaths } from "../helpers/check-paths";

/**
 * 全 Solver をランダム入力で回し、手法によらず成り立つべきことを検査する。
 *
 * ★ プリセットだけでは足りない。決め打ちの 4〜8 盤面は全部通るのに、
 *   ランダムに振ると壊れる例がいくつも見つかった。実際にこの検査で
 *   次が出ている。
 *     - RHCR が goal を通過しただけで「到達」と数え、goal から離れた
 *       場所で止まったまま solved を返していた
 *     - RHCR が、goal に着いて動けなくなった agent の上を別 agent に
 *       通らせていた（予約の順序）
 *     - 最小費用最大流が 6×4・2 体で無限ループし、timeoutMs も効かず
 *       タブごと固まっていた
 *
 * ★ 盤面数は CI で回る範囲に抑えてある。深く探すときは数を増やして
 *   手元で回すこと。
 */

const ctx = () =>
  createSolverContext({ seed: 1, signal: new AbortController().signal, emit: () => {} });

const cellSame = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x === b.x && a.y === b.y;

/** 衝突以外の破れだけ拾う。衝突は別に見る。 */
const isStructural = (rule: string) => !/同時刻に同じセル|edge swap|following/.test(rule);

/**
 * 衝突を解消しないと宣言している手法。
 * BFS / A* は各エージェントを独立に解くだけで、重なりは残す（解説にも明記）。
 */
const NO_CONFLICT_RESOLUTION = new Set(["bfs", "astar"]);

/** 実装として sum of costs 最適を主張できる手法。 */
const SOC_OPTIMAL = ["cbs", "icbs", "icts", "mstar"];

/** 実装として完全性を主張できる手法（探索上限内）。 */
const COMPLETE = ["cbs", "icbs", "mstar", "lacam", "lacam-star", "bcbs", "ecbs"];

function randomOneShot(seed: number): Scenario {
  const rnd = createRandom(seed);
  const w = 5 + randomInt(rnd, 3);
  const h = 4 + randomInt(rnd, 2);
  let map = createEmptyMap(w, h);
  for (let i = 0, n = randomInt(rnd, Math.floor(w * h * 0.18)); i < n; i += 1) {
    map = withBlocked(map, { x: randomInt(rnd, w), y: randomInt(rnd, h) }, true);
  }
  const free: { x: number; y: number }[] = [];
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) if (isWalkable(map, { x, y })) free.push({ x, y });
  if (free.length < 8) return randomOneShot(seed + 10000);
  const pool = [...free];
  const goals = [...free];
  const take = (a: typeof pool) => a.splice(randomInt(rnd, a.length), 1)[0]!;
  const agents = Array.from({ length: 2 + randomInt(rnd, 2) }, (_, i) => ({
    id: `a${i + 1}`,
    start: take(pool),
    goal: take(goals),
    colorIndex: i,
  }));
  return {
    id: `s${seed}`,
    name: `s${seed}`,
    kind: "one-shot-mapf",
    map,
    agents,
    rules: DEFAULT_RULES,
    seed,
  };
}

function randomMapd(seed: number): Scenario {
  const rnd = createRandom(seed);
  const width = 9 + 2 * randomInt(rnd, 3);
  let map = createEmptyMap(width, 5);
  for (const y of [1, 3])
    for (let x = 0; x < width; x += 1) if (x % 2 === 1) map = withBlocked(map, { x, y }, true);
  const alcove: { x: number; y: number }[] = [];
  for (const y of [1, 3]) for (let x = 0; x < width; x += 2) alcove.push({ x, y });
  const agents = Array.from({ length: 2 + randomInt(rnd, 3) }, (_, i) => ({
    id: `a${i + 1}`,
    start: { x: Math.min(width - 1, i * 3), y: 2 },
  }));
  const starts = new Set(agents.map((a) => `${a.start.x},${a.start.y}`));
  const work = alcove.filter((c) => !starts.has(`${c.x},${c.y}`) && isWalkable(map, c));
  const tasks: TaskSpec[] = Array.from({ length: 2 + randomInt(rnd, 4) }, (_, i) => ({
    id: `t${i + 1}`,
    pickup: work[randomInt(rnd, work.length)]!,
    delivery: work[randomInt(rnd, work.length)]!,
    releaseTime: randomInt(rnd, 8),
  }));
  return {
    id: `m${seed}`,
    name: `m${seed}`,
    kind: "mapd",
    map,
    agents,
    tasks,
    parkingEndpoints: agents.map((a) => ({ ...a.start })),
    rules: DEFAULT_RULES,
    seed,
  };
}

async function run(id: string, scenario: Scenario) {
  return getSolver(id)!.solve(scenario, DEFAULT_SOLVER_OPTIONS, ctx());
}

/** 手法によらず成り立つべきこと。破れをすべて文字列で返す。 */
async function invariantViolations(id: string, scenario: Scenario): Promise<string[]> {
  const bad: string[] = [];
  const result = await run(id, scenario);

  // 報告した衝突が実際と一致すること。
  const actual = detectConflicts(result.paths, scenario.rules);
  if (actual.length !== result.conflicts.length) {
    bad.push(`${scenario.id}: conflicts 報告 ${result.conflicts.length} ≠ 実際 ${actual.length}`);
  }

  if (result.outcome === "solved") {
    const structural = checkPaths(
      scenario.kind === "one-shot-mapf" ? scenario : { ...scenario, kind: "one-shot-mapf" },
      result.paths,
    ).filter((v) => isStructural(v.rule));
    if (scenario.kind !== "mapd" && structural.length) {
      bad.push(`${scenario.id}: ${structural[0]!.rule}/${structural[0]!.detail}`);
    }
    if (actual.length && !NO_CONFLICT_RESOLUTION.has(id)) {
      bad.push(`${scenario.id}: 衝突 ${actual.length} 件を残して solved`);
    }
    if ((result.metrics.pendingTasks ?? 0) > 0) {
      bad.push(`${scenario.id}: 未処理 ${result.metrics.pendingTasks} 件で solved`);
    }
    if (result.metrics.sumOfCosts !== sumOfCosts(result.paths)) {
      bad.push(
        `${scenario.id}: SOC ${result.metrics.sumOfCosts} ≠ 経路 ${sumOfCosts(result.paths)}`,
      );
    }
    if (result.metrics.makespan !== makespanOf(result.paths)) {
      bad.push(`${scenario.id}: makespan が経路と一致しない`);
    }
  }

  // 同じ入力・同じ seed なら同じ結果。
  const again = await run(id, scenario);
  if (
    again.outcome !== result.outcome ||
    JSON.stringify(again.paths) !== JSON.stringify(result.paths)
  ) {
    bad.push(`${scenario.id}: 同じ入力で結果が変わる`);
  }
  return bad;
}

const ONE_SHOT = Array.from({ length: 25 }, (_, i) => randomOneShot(i + 1));
const MAPD = Array.from({ length: 20 }, (_, i) => randomMapd(i + 1));

describe("one-shot MAPF の共通不変条件", () => {
  const ids = listSolverMetadata()
    .filter((m) => m.supports.includes("one-shot-mapf"))
    .map((m) => m.id);

  it.each(ids)(
    "%s",
    async (id) => {
      const bad: string[] = [];
      for (const scenario of ONE_SHOT) {
        if (!solversFor(scenario.kind, scenario).some((s) => s.metadata.id === id)) continue;
        bad.push(...(await invariantViolations(id, scenario)));
      }
      expect(bad, bad.slice(0, 3).join(" / ")).toEqual([]);
    },
    120_000,
  );
});

describe("one-shot MAPF の最適性と完全性", () => {
  /*
    ★ 最適解は参照実装（構成グラフ上の A*）で求める。証明つきのときだけ使う。
      最適を主張する手法がここからずれたら実装のバグ。
  */
  it("最適を主張する手法は参照実装と同じ sum of costs を返す", async () => {
    const bad: string[] = [];
    let checked = 0;
    for (const scenario of ONE_SHOT) {
      const oracle = jointStateOptimalSumOfCosts(scenario, 10);
      if (!oracle.solved || !oracle.sumOfCostsCertified) continue;
      checked += 1;
      for (const id of SOC_OPTIMAL) {
        const result = await run(id, scenario);
        if (result.outcome !== "solved") {
          bad.push(`${id}/${scenario.id}: 解けるはずが ${result.outcome}`);
        } else if (result.metrics.sumOfCosts !== oracle.sumOfCosts) {
          bad.push(
            `${id}/${scenario.id}: SOC ${result.metrics.sumOfCosts} ≠ 最適 ${oracle.sumOfCosts}`,
          );
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(bad, bad.slice(0, 3).join(" / ")).toEqual([]);
  }, 120_000);

  it("完全性を主張する手法は、解ける盤面を必ず解く", async () => {
    const bad: string[] = [];
    for (const scenario of ONE_SHOT) {
      const oracle = jointStateOptimalSumOfCosts(scenario, 10);
      if (!oracle.solved) continue;
      for (const id of COMPLETE) {
        const result = await run(id, scenario);
        if (result.outcome !== "solved") bad.push(`${id}/${scenario.id}: ${result.outcome}`);
      }
    }
    expect(bad, bad.slice(0, 3).join(" / ")).toEqual([]);
  }, 120_000);
});

describe("有界準最適の保証", () => {
  /*
    ★ 有界準最適は「係数 w 以内に収まる」という約束。
      約束が守られているかは、参照実装の最適値と突き合わせないと分からない。

      3 つ見る。
        1. 解のコストが w × 最適 以内か（約束そのもの）
        2. 報告した lowerBound が本当に下界か（最適値を上回っていないか）
        3. 報告した suboptimalityBound が w 以内か（型の説明どおりか）

      2 が要るのは、下界を大きく見せれば「比」はいくらでも小さく見えるため。
      下界が偽なら 3 は無意味になる。
  */
  const BOUNDED = ["bcbs", "ecbs", "eecbs"];
  const FACTORS = [1.1, 2, 3];

  it.each(BOUNDED)(
    "%s は係数どおりに収まる",
    async (id) => {
      const bad: string[] = [];
      let checked = 0;
      for (const factor of FACTORS) {
        for (const scenario of ONE_SHOT) {
          const oracle = jointStateOptimalSumOfCosts(scenario, 10);
          if (!oracle.solved || !oracle.sumOfCostsCertified) continue;
          const result = await getSolver(id)!.solve(
            scenario,
            { ...DEFAULT_SOLVER_OPTIONS, suboptimalityFactor: factor },
            ctx(),
          );
          if (result.outcome !== "solved") continue;
          checked += 1;
          const { sumOfCosts: soc, lowerBound, suboptimalityBound } = result.metrics;
          if (soc > factor * oracle.sumOfCosts + 1e-9) {
            bad.push(`w=${factor}/${scenario.id}: SOC ${soc} > ${factor}×${oracle.sumOfCosts}`);
          }
          if (lowerBound !== undefined && lowerBound > oracle.sumOfCosts + 1e-9) {
            bad.push(
              `w=${factor}/${scenario.id}: lowerBound ${lowerBound} が最適 ${oracle.sumOfCosts} を超える`,
            );
          }
          if (suboptimalityBound !== undefined && suboptimalityBound > factor + 1e-9) {
            bad.push(`w=${factor}/${scenario.id}: 報告比 ${suboptimalityBound} > w=${factor}`);
          }
        }
      }
      expect(checked).toBeGreaterThan(30);
      expect(bad, bad.slice(0, 3).join(" / ")).toEqual([]);
    },
    120_000,
  );

  /*
    ★ 上の検査は「w を完全に無視して毎回最適解を返す実装」でも通る。
      w が本当に高レベル探索へ渡っているかは別に見ないと分からない。

      直接の証拠は展開ノード数。focal を広げれば早く打ち切れるので、
      w を広げたときに展開が減っていなければ w は使われていない。
      余裕は大きい（この盤面集合で 450 → 307 前後）。

      「最適から離れた解を実際に返したか」も数えるが、こちらは
      盤面が小さいと 25 例中 1〜2 例しか出ない。手法ごとに 1 件以上を
      要求すると、盤面生成をいじっただけで落ちる。全体で 1 件以上に
      とどめ、主たる判定は展開数に置く。
  */
  const expandedTotal = async (id: string, factor: number) => {
    let expanded = 0;
    let relaxed = 0;
    for (const scenario of ONE_SHOT) {
      const oracle = jointStateOptimalSumOfCosts(scenario, 10);
      if (!oracle.solved || !oracle.sumOfCostsCertified) continue;
      const result = await getSolver(id)!.solve(
        scenario,
        { ...DEFAULT_SOLVER_OPTIONS, suboptimalityFactor: factor },
        ctx(),
      );
      if (result.outcome !== "solved") continue;
      expanded += result.metrics.expandedNodes ?? 0;
      if (result.metrics.sumOfCosts > oracle.sumOfCosts) relaxed += 1;
    }
    return { expanded, relaxed };
  };

  it("係数を広げると探索が実際に浅くなる", async () => {
    let relaxedAll = 0;
    for (const id of BOUNDED) {
      const tight = await expandedTotal(id, 1);
      const loose = await expandedTotal(id, 3);
      expect(
        loose.expanded,
        `${id}: w=3 の展開 ${loose.expanded} が w=1 の ${tight.expanded} 以上`,
      ).toBeLessThan(tight.expanded);
      relaxedAll += loose.relaxed;
    }
    expect(relaxedAll, "どの手法も w=3 で一度も最適から離れない").toBeGreaterThan(0);
  }, 120_000);

  /*
    ★ w=1 は最適解法と同じでなければならない（focal が open と一致する）。
      ここがずれるなら focal の条件式が間違っている。
  */
  it.each(BOUNDED)(
    "%s は係数 1 なら最適解に戻る",
    async (id) => {
      const bad: string[] = [];
      for (const scenario of ONE_SHOT) {
        const oracle = jointStateOptimalSumOfCosts(scenario, 10);
        if (!oracle.solved || !oracle.sumOfCostsCertified) continue;
        const result = await getSolver(id)!.solve(
          scenario,
          { ...DEFAULT_SOLVER_OPTIONS, suboptimalityFactor: 1 },
          ctx(),
        );
        if (result.outcome !== "solved") {
          bad.push(`${scenario.id}: ${result.outcome}`);
        } else if (result.metrics.sumOfCosts !== oracle.sumOfCosts) {
          bad.push(`${scenario.id}: SOC ${result.metrics.sumOfCosts} ≠ 最適 ${oracle.sumOfCosts}`);
        }
      }
      expect(bad, bad.slice(0, 3).join(" / ")).toEqual([]);
    },
    120_000,
  );

  it("最適解法に係数を渡したら、使わない旨を伝える", async () => {
    const result = await getSolver("cbs")!.solve(
      ONE_SHOT[0]!,
      { ...DEFAULT_SOLVER_OPTIONS, suboptimalityFactor: 2 },
      ctx(),
    );
    const messages = (result.warnings ?? []).map((w) => w.message).join("\n");
    expect(messages).toContain("suboptimalityFactor");
  }, 60_000);
});

describe("MAPD の共通不変条件", () => {
  const ids = listSolverMetadata()
    .filter((m) => m.supports.includes("mapd"))
    .map((m) => m.id);

  it.each(ids)(
    "%s",
    async (id) => {
      const bad: string[] = [];
      for (const scenario of MAPD) {
        if (!checkWellFormed(scenario).checked) continue;
        bad.push(...(await invariantViolations(id, scenario)));
      }
      expect(bad, bad.slice(0, 3).join(" / ")).toEqual([]);
    },
    120_000,
  );
});

describe("TAPF の共通不変条件", () => {
  const ids = listSolverMetadata()
    .filter((m) => m.supports.includes("tapf") && m.id !== "tapf-baseline")
    .map((m) => m.id);
  const samples = Array.from({ length: 12 }, (_, i) => {
    const rnd = createRandom(i + 1);
    const w = 5 + randomInt(rnd, 2);
    let map = createEmptyMap(w, 4);
    for (let k = 0, n = randomInt(rnd, 3); k < n; k += 1) {
      map = withBlocked(map, { x: randomInt(rnd, w), y: randomInt(rnd, 4) }, true);
    }
    const free: { x: number; y: number }[] = [];
    for (let y = 0; y < 4; y += 1)
      for (let x = 0; x < w; x += 1) if (isWalkable(map, { x, y })) free.push({ x, y });
    const pool = [...free];
    const goals = [...free];
    const take = (a: typeof pool) => a.splice(randomInt(rnd, a.length), 1)[0]!;
    const agents = [0, 1].map((k) => ({ id: `a${k + 1}`, start: take(pool), colorIndex: 0 }));
    const teams = [
      {
        id: "team1",
        agentIds: agents.map((a) => a.id),
        goals: [take(goals), take(goals)],
        colorIndex: 0,
      },
    ];
    return {
      id: `p${i + 1}`,
      name: `p${i + 1}`,
      kind: "tapf" as const,
      map,
      agents,
      teams,
      rules: DEFAULT_RULES,
      seed: i + 1,
    };
  }).filter((s) => validateScenario(s).length === 0);

  it("十分な数の盤面がある", () => {
    expect(samples.length).toBeGreaterThan(8);
  });

  it.each(ids)("%s", async (id) => {
    const bad: string[] = [];
    for (const scenario of samples) {
      if (!solversFor(scenario.kind, scenario).some((s) => s.metadata.id === id)) continue;
      bad.push(...(await invariantViolations(id, scenario)));
    }
    expect(bad, bad.slice(0, 3).join(" / ")).toEqual([]);
  });

  /*
    ★ CBM は makespan 最適（cbm-tapf-aamas-2016 p.2）。
      全探索割当 + CBS は小規模なら確実に makespan 最適なので、
      そこからずれたら CBM 側のバグ。
  */
  it("CBM の makespan は全探索と一致する", async () => {
    const bad: string[] = [];
    let checked = 0;
    for (const scenario of samples.slice(0, 8)) {
      const base = await run("tapf-baseline", scenario);
      const cbm = await run("cbm", scenario);
      if (base.outcome !== "solved" || cbm.outcome !== "solved") continue;
      checked += 1;
      if (base.metrics.makespan !== cbm.metrics.makespan) {
        bad.push(`${scenario.id}: CBM ${cbm.metrics.makespan} ≠ 全探索 ${base.metrics.makespan}`);
      }
    }
    expect(checked).toBeGreaterThan(3);
    expect(bad, bad.join(" / ")).toEqual([]);
  }, 120_000);
});

describe("プリセットと Solver の噛み合わせ", () => {
  /*
    ★ プリセット × 候補に出る全 Solver を、探索上限を絞って一周する。

      上限を絞るのは速さのためだけではない。「途中で打ち切られた」状態を
      作らないと次の 2 つ目が検査できない。既定の上限だと小さいプリセットは
      全部完走してしまう（既定で一周すると 135 秒かかるうえ、打ち切りが
      起きないので取りこぼす。上限 100 なら 0.5 秒で、しかも打ち切りが起きる）。

      1. 候補に出した Solver が invalid-scenario で落ちないこと。
         Space-Time A* は単一エージェント専用なのに canSolve が無く、
         one-shot のプリセットは当時 8 件すべて 2 体以上だったので、
         画面から選ぶと必ずエラーになっていた。
         受け付けない形は solve の中ではなく canSolve で断ること。

      2. 全員が goal に着いた衝突ゼロの経路を持っているなら solved を
         名乗ること。LaCAM* と MAPF-LNS が、有効な解を返しながら
         outcome に打ち切り理由（timeout / node-limit）を入れていた。
         画面には「時間切れ」と出るので、利用者からは失敗に見える。
         打ち切った事実は warnings で伝えるべきもので、outcome ではない。
  */
  const CAPS = [100, 1000];

  it("候補に出した Solver は、エラーにならず、解があれば solved を名乗る", async () => {
    const bad: string[] = [];
    for (const preset of PRESETS) {
      const scenario = buildPreset(preset.id, 1);
      for (const meta of listSolverMetadataFor(scenario)) {
        for (const maxExpansions of CAPS) {
          const result = await getSolver(meta.id)!.solve(
            scenario,
            { ...DEFAULT_SOLVER_OPTIONS, maxExpansions },
            ctx(),
          );
          const where = `${preset.id}/${meta.id}(上限 ${maxExpansions})`;
          if (result.outcome === "error") {
            bad.push(`${where}: ${result.error?.code} ${result.error?.message ?? ""}`);
            continue;
          }
          if (result.outcome === "solved") continue;
          if (scenario.kind !== "one-shot-mapf") continue;
          if (result.paths.length !== scenario.agents.length) continue;
          const reached = result.paths.every((path) => {
            const agent = scenario.agents.find((a) => a.id === path.agentId);
            const last = path.positions.at(-1)?.cell;
            return agent?.goal && last && cellSame(last, agent.goal);
          });
          const clean =
            detectConflicts(result.paths, scenario.rules).length === 0 &&
            checkPaths(scenario, result.paths).length === 0;
          if (reached && clean) {
            bad.push(`${where}: 有効な解を持ちながら ${result.outcome} を返す`);
          }
        }
      }
    }
    expect(bad, bad.slice(0, 3).join(" / ")).toEqual([]);
  }, 300_000);

  it("Space-Time A* は 1 体の盤面にだけ候補として出る", () => {
    const listed = (id: string) =>
      listSolverMetadataFor(buildPreset(id, 1)).some((m) => m.id === "space-time-astar");
    expect(listed("single-agent")).toBe(true);
    expect(buildPreset("single-agent", 1).agents).toHaveLength(1);
    for (const preset of PRESETS) {
      const scenario = buildPreset(preset.id, 1);
      if (scenario.kind !== "one-shot-mapf" || scenario.agents.length === 1) continue;
      expect(listed(preset.id), `${preset.id} に単一エージェント専用が出ている`).toBe(false);
    }
  });

  /*
    ★ 打ち切って incumbent を返す場合、解は有効でも最適ではない
      （lacam-star-ijcai-2023 p.4 Algorithm 3 lines 27-30 が OPEN 完了時を
      optimal、interruption 時を sub-optimal と分ける）。
      solved にしたぶん、最適でない旨を必ず添えること。
  */
  it("LaCAM* は打ち切っても、解があれば solved と「最適ではない」を返す", async () => {
    const scenario = buildPreset("warehouse", 1);
    const result = await getSolver("lacam-star")!.solve(
      scenario,
      { ...DEFAULT_SOLVER_OPTIONS, maxExpansions: 100 },
      ctx(),
    );
    expect(result.outcome).toBe("solved");
    expect(result.failureReason).toBeUndefined();
    expect(detectConflicts(result.paths, scenario.rules)).toHaveLength(0);
    const messages = (result.warnings ?? []).map((w) => w.message).join("\n");
    expect(messages).toContain("最適解ではありません");
    expect(messages).toContain("展開数の上限");
  }, 60_000);
});
