import { describe, expect, it } from "vitest";
import type { Scenario, SolverOptions } from "@/lib/model/types";
import { DEFAULT_RULES, DEFAULT_SOLVER_OPTIONS } from "@/lib/model/types";
import { createEmptyMap } from "@/lib/model/grid";
import { detectConflicts, makespanOf, sumOfCosts } from "@/lib/model/conflicts";
import { getSolver, listSolvers } from "@/solvers/registry";
import { createRecordingContext } from "@/solvers/context";
import { decomposeAndOrder } from "@/solvers/push/decomposition";
import { PushEngine } from "@/solvers/push/engine";
import { jointStateBfs, jointStateOptimalSumOfCosts } from "@/solvers/reference/joint-state";
import { checkPaths } from "../helpers/check-paths";

const IDS = ["icts", "mstar", "push-and-swap", "push-and-rotate"] as const;

function scenario(width = 3, height = 2): Scenario {
  return {
    id: "batch4",
    name: "batch4",
    kind: "one-shot-mapf",
    map: createEmptyMap(width, height),
    agents: [
      { id: "a1", start: { x: 0, y: 0 }, goal: { x: width - 1, y: 0 } },
      { id: "a2", start: { x: width - 1, y: 0 }, goal: { x: 0, y: 0 } },
    ],
    rules: DEFAULT_RULES,
    seed: 7,
  };
}

function independent(): Scenario {
  return {
    ...scenario(4, 2),
    id: "independent",
    agents: [
      { id: "a1", start: { x: 0, y: 0 }, goal: { x: 3, y: 0 } },
      { id: "a2", start: { x: 3, y: 1 }, goal: { x: 0, y: 1 } },
    ],
  };
}

async function solve(
  id: (typeof IDS)[number],
  input: Scenario,
  options: SolverOptions = DEFAULT_SOLVER_OPTIONS,
) {
  const solver = getSolver(id);
  expect(solver).toBeDefined();
  const { context, events } = createRecordingContext(input.seed);
  const result = await solver!.solve(input, options, context);
  return { result, events };
}

describe("Batch 4 registry / metadata", () => {
  it("4 solver が重複なく登録される", () => {
    const ids = listSolvers().map((solver) => solver.metadata.id);
    for (const id of IDS) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getSolver("push-and-rotate")!.metadata.status).toBe("runnable");
    /*
      ★ paper-faithful から educational へ下げた。
        原論文 Theorem 1 のクラス（各連結成分に空き頂点 2 個以上）でも
        失敗する例が見つかっている（swap の多段 clear が論文どおりでない）。
        再現度を主張できない以上、ラベルを下げるほうが正確である。
    */
    expect(getSolver("push-and-rotate")!.metadata.fidelity).toBe("educational");
  });
});

describe.each(["icts", "mstar"] as const)("%s optimal search", (id) => {
  it.each([scenario(), independent()])("小規模例で oracle と SOC が一致する", async (input) => {
    const oracle = jointStateOptimalSumOfCosts(input, 8);
    expect(oracle.solved && oracle.sumOfCostsCertified).toBe(true);
    const { result } = await solve(id, input, {
      ...DEFAULT_SOLVER_OPTIONS,
      maxExpansions: 500_000,
      extra: id === "icts" ? { maxIndividualCost: 12 } : { maxTimesteps: 12 },
    });
    expect(result.outcome, JSON.stringify(result.error ?? result.warnings ?? result)).toBe(
      "solved",
    );
    expect(checkPaths(input, result.paths)).toEqual([]);
    expect(result.metrics.sumOfCosts).toBe(sumOfCosts(result.paths));
    expect(result.metrics.makespan).toBe(makespanOf(result.paths));
    expect(result.metrics.sumOfCosts).toBe(oracle.sumOfCosts);
  });

  it("同じ入力と seed で決定的", async () => {
    const first = await solve(id, scenario());
    const second = await solve(id, scenario());
    expect(second.result.paths).toEqual(first.result.paths);
  });
});

describe("ICTS events / limits", () => {
  it("ICT node と MDD 構築を可視化する", async () => {
    const { result, events } = await solve("icts", scenario(), {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
    });
    expect(result.outcome, JSON.stringify(result.error ?? result.warnings ?? result)).toBe(
      "solved",
    );
    expect(events.some((event) => event.type === "create-ict-node")).toBe(true);
    expect(events.some((event) => event.type === "build-mdd")).toBe(true);
  });

  it("個別 cost horizon を証明付き no-solution と誤表示しない", async () => {
    const { result } = await solve("icts", scenario(), {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { maxIndividualCost: 2 },
    });
    expect(result.outcome).toBe("node-limit");
    expect(result.failureReason).toBe("limit-exceeded");
  });
});

describe("M* collision-set", () => {
  it("衝突時に collision set を更新する", async () => {
    const { result, events } = await solve("mstar", scenario(), {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
    });
    expect(result.outcome).toBe("solved");
    expect(events.some((event) => event.type === "update-collision-set")).toBe(true);
  });
});

describe.each(["push-and-swap", "push-and-rotate"] as const)("%s primitives", (id) => {
  it("空き 2 vertex を使う swap 例で妥当な逐次 plan を返す", async () => {
    const input = scenario(3, 2);
    const { result, events } = await solve(id, input, {
      ...DEFAULT_SOLVER_OPTIONS,
      maxExpansions: 200_000,
      extra:
        id === "push-and-swap" ? { maxMoves: 500, agentOrder: ["a1", "a2"] } : { maxMoves: 500 },
    });
    expect(result.outcome, JSON.stringify(result.error ?? result.warnings ?? result)).toBe(
      "solved",
    );
    expect(checkPaths(input, result.paths)).toEqual([]);
    expect(result.metrics.sumOfCosts).toBe(sumOfCosts(result.paths));
    expect(result.metrics.makespan).toBe(makespanOf(result.paths));
    expect(events.some((event) => event.type === "push-agent")).toBe(true);
  });

  it("空き vertex が 2 個未満なら対象 class 外として弾く", async () => {
    const full: Scenario = {
      ...scenario(2, 1),
      id: "full",
    };
    const { result } = await solve(id, full);
    expect(result.outcome).toBe("error");
    expect(result.error?.code).toBe("unsupported-rules");
  });

  it("同じ入力と seed で決定的", async () => {
    const first = await solve(id, scenario());
    const second = await solve(id, scenario());
    expect(second.result.outcome).toBe(first.result.outcome);
    expect(second.result.paths).toEqual(first.result.paths);
  });
});

describe("Push and Rotate rotate", () => {
  it("swap primitive が対象 2 agent だけの位置を交換する", () => {
    const map = createEmptyMap(3, 2);
    const agents = [0, 1].map((start, index) => ({
      id: `r${index}`,
      start: { x: start, y: 0 },
      goal: { x: start, y: 0 },
    }));
    const engine = new PushEngine({
      map,
      agents,
      maxMoves: 500,
      consumeExpansion: () => null,
      emit: () => undefined,
    });

    expect(engine.swapAgents(0, 1)).toBe(true);
    expect(engine.positions).toEqual([1, 0]);
  });

  it("密な二部屋 graph でも swap 後に対象外 agent を元へ戻す", () => {
    const map = twoRoomMap();
    const starts = [0, 1, 7, 8, 9, 5, 6, 12, 13];
    const agents = starts.map((start, index) => ({
      id: `r${index}`,
      start: { x: start % map.width, y: Math.floor(start / map.width) },
      goal: { x: start % map.width, y: Math.floor(start / map.width) },
    }));
    const engine = new PushEngine({
      map,
      agents,
      maxMoves: 500,
      consumeExpansion: () => null,
      emit: () => undefined,
    });

    expect(engine.swapAgents(1, 0)).toBe(true);
    expect(engine.positions).toEqual([1, 0, 7, 8, 9, 5, 6, 12, 13]);
  });

  it.each([
    {
      name: "空き vertex を含む cycle",
      starts: [0, 1, 4],
      expected: [1, 4, 3],
    },
    {
      name: "満杯 cycle",
      starts: [0, 1, 4, 3],
      expected: [1, 4, 3, 0],
    },
  ])("$name を逐次合法 move だけで 1 回転する", ({ starts, expected }) => {
    const map = createEmptyMap(3, 2);
    const agents = starts.map((start, index) => ({
      id: `r${index}`,
      start: { x: start % map.width, y: Math.floor(start / map.width) },
      goal: { x: start % map.width, y: Math.floor(start / map.width) },
    }));
    const events: { type: string }[] = [];
    const engine = new PushEngine({
      map,
      agents,
      maxMoves: 500,
      consumeExpansion: () => null,
      emit: (event) => events.push(event),
    });

    expect(engine.rotateCycle([0, 1, 4, 3])).toBe(true);
    expect(engine.positions).toEqual(expected);
    expect(engine.frames).toHaveLength(engine.records.length + 1);
    for (let time = 1; time < engine.frames.length; time += 1) {
      const before = engine.frames[time - 1]!;
      const after = engine.frames[time]!;
      const moved = before.flatMap((vertex, agent) =>
        vertex === after[agent] ? [] : [{ from: vertex, to: after[agent]! }],
      );
      expect(moved).toHaveLength(1);
      expect(
        Math.abs((moved[0]!.from % 3) - (moved[0]!.to % 3)) +
          Math.abs(Math.floor(moved[0]!.from / 3) - Math.floor(moved[0]!.to / 3)),
      ).toBe(1);
      expect(new Set(after).size).toBe(after.length);
    }
    expect(events.some((event) => event.type === "rotate-cycle")).toBe(true);
  });

  it("subproblem 作成と論文由来の priority order を可視化する", async () => {
    const { result, events } = await solve("push-and-rotate", scenario(), {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "detailed",
    });
    expect(result.outcome).toBe("solved");
    expect(events.some((event) => event.type === "create-subproblem")).toBe(true);
    expect(events.some((event) => event.type === "priority-order")).toBe(true);
  });

  it("isthmus で隔てた subproblem 間に goal 由来の優先関係を作る", () => {
    const map = twoRoomMap();
    const { width } = map;
    const starts = [0, 1, 7, 8, 9, 5, 6, 12, 13];
    const goals = [0, 1, 7, 6, 9, 5, 8, 12, 13];
    const agents = starts.map((start, index) => ({
      id: `r${index}`,
      start: { x: start % width, y: Math.floor(start / width) },
      goal: { x: goals[index]! % width, y: Math.floor(goals[index]! / width) },
    }));

    const decomposition = decomposeAndOrder(
      map,
      agents,
      () => 0.5,
      () => false,
    );
    expect(decomposition.stopped).toBe(false);
    expect(decomposition.brokeCycle).toBe(false);
    const left = decomposition.subproblems.findIndex((part) => part.cells.includes(8));
    const right = decomposition.subproblems.findIndex((part) => part.cells.includes(12));
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeGreaterThanOrEqual(0);
    expect(left).not.toBe(right);
    expect(decomposition.priorityEdges).toContainEqual({ higher: left, lower: right });
  });

  /*
    ★ 優先度関係の閉路は「解なし」ではない。

      原論文 Algorithm 4 は毎回「(equal) highest priority の未完了 agent を
      randomly select」する方式で、事前の全順序を要求しない。解が無いと
      判定してよいのは Theorem 1 の条件（swap の失敗）だけである。

      以前はここで order を空にして impossible を立て、solver 側が警告も
      無しに no-solution / search-exhausted を返していた。
  */
  it("相反する subproblem priority では閉路を切って順序を作る", () => {
    const map = twoRoomMap();
    const starts = [0, 1, 7, 8, 9, 5, 6, 12, 13];
    const goals = [0, 12, 7, 6, 9, 5, 8, 1, 13];
    const agents = starts.map((start, index) => ({
      id: `r${index}`,
      start: { x: start % map.width, y: Math.floor(start / map.width) },
      goal: { x: goals[index]! % map.width, y: Math.floor(goals[index]! / map.width) },
    }));

    const decomposition = decomposeAndOrder(
      map,
      agents,
      () => 0.5,
      () => false,
    );
    expect(decomposition.stopped).toBe(false);
    expect(decomposition.brokeCycle).toBe(true);
    // 全 agent が並ぶこと。順序が空だと solve へ進めない。
    expect([...decomposition.order].sort((a, b) => a - b)).toEqual(agents.map((_, index) => index));
  });

  it("2 個の空きだけを持つ二部屋 graph で両 subproblem の配置を解く", async () => {
    const map = twoRoomMap();
    const starts = [0, 1, 7, 8, 9, 5, 6, 12, 13];
    const goals = [1, 0, 7, 8, 9, 6, 5, 12, 13];
    const input: Scenario = {
      ...scenario(),
      id: "push-rotate-two-rooms",
      map,
      agents: starts.map((start, index) => ({
        id: `r${index}`,
        start: { x: start % map.width, y: Math.floor(start / map.width) },
        goal: { x: goals[index]! % map.width, y: Math.floor(goals[index]! / map.width) },
      })),
    };

    const { result, events } = await solve("push-and-rotate", input, {
      ...DEFAULT_SOLVER_OPTIONS,
      maxAgents: 20,
      maxExpansions: 2_000_000,
      maxHorizon: 2_000,
      extra: { maxMoves: 2_000 },
    });
    expect(
      result.outcome,
      JSON.stringify({
        detail: result.error ?? result.warnings ?? result,
        events: events.filter(
          (event) =>
            event.type === "progress" ||
            event.type === "swap-agents" ||
            (event.type === "push-agent" && ["r0", "r1", "r3"].includes(event.agentId)),
        ),
      }),
    ).toBe("solved");
    expect(checkPaths(input, result.paths)).toEqual([]);
  });

  it("2 個以上の空きを持つ小規模 configuration 群を解く", async () => {
    for (const agentCount of [2, 3, 4]) {
      for (let caseIndex = 1; caseIndex <= 12; caseIndex += 1) {
        const starts = shuffledVertices(caseIndex * 17 + agentCount).slice(0, agentCount);
        const goals = shuffledVertices(caseIndex * 31 + agentCount * 7).slice(0, agentCount);
        const input: Scenario = {
          ...scenario(3, 2),
          id: `push-rotate-${agentCount}-${caseIndex}`,
          agents: starts.map((start, index) => ({
            id: `r${index}`,
            start: { x: start % 3, y: Math.floor(start / 3) },
            goal: { x: goals[index]! % 3, y: Math.floor(goals[index]! / 3) },
          })),
          seed: caseIndex,
        };
        const oracle = jointStateBfs(input, 20);
        expect(oracle.solved).toBe(true);
        const { result } = await solve("push-and-rotate", input, {
          ...DEFAULT_SOLVER_OPTIONS,
          maxExpansions: 1_000_000,
          extra: { maxMoves: 1_500 },
        });
        expect(
          result.outcome,
          `${input.id}: ${JSON.stringify(result.error ?? result.warnings ?? result)}`,
        ).toBe("solved");
        expect(checkPaths(input, result.paths), input.id).toEqual([]);
      }
    }
  });
});

function shuffledVertices(seed: number): number[] {
  const result = [0, 1, 2, 3, 4, 5];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const selected = state % (index + 1);
    [result[index], result[selected]] = [result[selected]!, result[index]!];
  }
  return result;
}

function twoRoomMap() {
  const width = 7;
  const height = 3;
  const walkable = new Set([0, 1, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  return {
    width,
    height,
    blocked: Array.from({ length: width * height }, (_, index) => !walkable.has(index)),
  };
}

describe("Push and Swap disclosure", () => {
  it("失敗時は一般の解なし証明でないと警告する", async () => {
    const { result } = await solve("push-and-swap", scenario(), {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { maxMoves: 1 },
    });
    expect(result.outcome).not.toBe("solved");
    expect(result.warnings ?? []).not.toHaveLength(0);
  });
});

describe("共通 safety", () => {
  it.each(IDS)("%s は maxExpansions を守る", async (id) => {
    const { result } = await solve(id, scenario(), {
      ...DEFAULT_SOLVER_OPTIONS,
      maxExpansions: 1,
    });
    expect(["node-limit", "error"]).toContain(result.outcome);
  });

  it.each(IDS)("%s は AbortSignal を見る", async (id) => {
    const solver = getSolver(id)!;
    const controller = new AbortController();
    controller.abort();
    const { context } = createRecordingContext(1, controller.signal);
    const result = await solver.solve(scenario(), DEFAULT_SOLVER_OPTIONS, context);
    expect(result.outcome).toBe("aborted");
  });

  it.each(IDS)("%s は timeout を守る", async (id) => {
    const { result } = await solve(id, scenario(), {
      ...DEFAULT_SOLVER_OPTIONS,
      timeoutMs: 0,
    });
    expect(result.outcome).toBe("timeout");
  });

  it.each(IDS)("%s は input limit を探索前に適用する", async (id) => {
    const { result } = await solve(id, scenario(), {
      ...DEFAULT_SOLVER_OPTIONS,
      maxAgents: 1,
    });
    expect(result.outcome).toBe("error");
    expect(result.failureReason).toBe("limit-exceeded");
  });

  it.each(IDS)("%s は diagonal rule を黙って解かない", async (id) => {
    const input: Scenario = {
      ...scenario(),
      rules: { ...DEFAULT_RULES, allowDiagonal: true },
    };
    const { result } = await solve(id, input);
    expect(result.outcome).toBe("error");
    expect(result.error?.code).toBe("unsupported-rules");
  });

  /*
    ★ following 禁止は ICTS / M* とも扱えるようになった。
      どちらも配置遷移を直接見る手法なので、from/to の組から判定できる。
      「受けたなら守る」ことを確かめる（黙って破らない）。
  */
  it.each(["icts", "mstar"] as const)("%s は following conflict 禁止を守って解く", async (id) => {
    const input: Scenario = {
      ...scenario(),
      rules: { ...DEFAULT_RULES, forbidFollowing: true },
    };
    const { result } = await solve(id, input);
    expect(result.outcome).not.toBe("error");
    if (result.outcome !== "solved") return;
    expect(detectConflicts(result.paths, input.rules)).toEqual([]);
    expect(checkPaths(input, result.paths)).toEqual([]);
  });

  /*
    ★ push 操作は「押した相手が空けたセルへ入る」ことそのもので、
      following conflict にあたる。禁止すると手法の中核が成り立たないので、
      黙って別物を動かすのではなく理由を添えて断ること。
  */
  it.each(["push-and-swap", "push-and-rotate"] as const)(
    "%s は following conflict 禁止を、理由を添えて断る",
    async (id) => {
      const input: Scenario = {
        ...scenario(),
        rules: { ...DEFAULT_RULES, forbidFollowing: true },
      };
      const { result } = await solve(id, input);
      expect(result.outcome).toBe("error");
      expect(result.error?.code).toBe("unsupported-rules");
      expect(result.error?.message).toContain("push");
    },
  );

  it.each(IDS)("%s は trace 上限を守る", async (id) => {
    const { result } = await solve(id, scenario(), {
      ...DEFAULT_SOLVER_OPTIONS,
      traceLevel: "verbose",
      maxTraceEvents: 1,
    });
    expect(result.trace?.length).toBeLessThanOrEqual(1);
    expect(result.warnings?.some((warning) => warning.code === "trace-truncated")).toBe(true);
  });
});

describe("option validation", () => {
  it("Push agentOrder は全 ID の permutation だけを受ける", async () => {
    const { result } = await solve("push-and-swap", scenario(), {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { agentOrder: ["a1", "a1"] },
    });
    expect(result.outcome).toBe("error");
    expect(result.error?.code).toBe("invalid-scenario");
  });

  it("Push and Rotate の agentOrder 上書きを拒否する", async () => {
    const { result } = await solve("push-and-rotate", scenario(), {
      ...DEFAULT_SOLVER_OPTIONS,
      extra: { agentOrder: ["a1", "a2"] },
    });
    expect(result.outcome).toBe("error");
    expect(result.error?.code).toBe("invalid-scenario");
  });

  it("Push and Rotate の成功結果に簡略実装警告を付けない", async () => {
    const { result } = await solve("push-and-rotate", scenario());
    expect(result.outcome, JSON.stringify(result.error ?? result.warnings ?? result)).toBe(
      "solved",
    );
    expect(result.warnings?.some((warning) => warning.code === "simplified-behavior")).not.toBe(
      true,
    );
  });
});
