import { describe, expect, it } from "vitest";
import { implementationStateOf, isRunnable } from "@/lib/implementation-state";
import { algorithms, getAlgorithm } from "@/lib/manifest";
import { RUNNABLE_ALGORITHM_IDS } from "@/solvers/registry";

/*
  ★ この判定は AlgorithmCard / AlgorithmStatus / compare / roadmap の 4 箇所に
    同じ式が重複していて、1 箇所だけ直された結果、registry にある partial の
    手法が「シミュレータで実行可」と表示される過大主張が実際に起きた。
    共通化したうえで、ここで規則そのものを固定する。
*/
describe("実装状態の判定", () => {
  it("registry にある partial は runnable へ格上げしない", () => {
    // ICBS は registry にあるが原論文の全機能を再現していない。
    expect(RUNNABLE_ALGORITHM_IDS).toContain("icbs");
    expect(getAlgorithm("icbs")?.implementation_status).toBe("partial");
    expect(implementationStateOf("icbs")).toBe("partial");
    // 「動くか」という問いには partial も yes。
    expect(isRunnable("icbs")).toBe(true);
  });

  it("registry にある runnable はそのまま runnable", () => {
    expect(implementationStateOf("cbs")).toBe("runnable");
    expect(isRunnable("cbs")).toBe(true);
  });

  it("Batch 5 の registry 登録と manifest 宣言が一致する", () => {
    expect(RUNNABLE_ALGORITHM_IDS).toContain("lacam");
    expect(RUNNABLE_ALGORITHM_IDS).toContain("lacam-star");
    expect(implementationStateOf("lacam")).toBe("runnable");
    expect(implementationStateOf("lacam-star")).toBe("runnable");
    expect(isRunnable("lacam")).toBe(true);
  });

  it("マニフェストに無い id は planned", () => {
    expect(implementationStateOf("not-a-real-algorithm")).toBe("planned");
    expect(isRunnable("not-a-real-algorithm")).toBe(false);
  });

  /*
    ★ 過大主張の一般形を封じる。
      registry に無い手法が「動く」側に分類されることは決して無い。
  */
  it("registry に無い手法が runnable / partial と表示されることは無い", () => {
    for (const algo of algorithms) {
      if (RUNNABLE_ALGORITHM_IDS.includes(algo.id)) continue;
      const state = implementationStateOf(algo.id);
      expect(["planned", "explanation-only"], `${algo.id} が ${state}`).toContain(state);
      expect(isRunnable(algo.id), `${algo.id}`).toBe(false);
    }
  });
});
