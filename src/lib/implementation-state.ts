import { getAlgorithm } from "@/lib/manifest";
import { RUNNABLE_ALGORITHM_IDS } from "@/solvers/registry";

/**
 * 手法の「実際に動くか」を一箇所で決める。
 *
 * ★ なぜ共通化してあるか:
 *   この判定は AlgorithmCard / AlgorithmStatus / compare / roadmap の
 *   4 箇所で同じ式を書いていた。1 箇所だけ直された結果、registry にある
 *   partial の手法（ICBS）が「シミュレータで実行可」と表示される
 *   過大主張が実際に発生した。判定を増やすなら必ずここだけを触る。
 *
 * ★ 判定の原則: シミュレータで動くかどうかは registry（実際に登録された
 *   Solver）が唯一の真値。algorithms.yaml の宣言だけを信用しない。
 *   宣言が registry より前に出ている場合は registry 側へ引き下げる。
 */
export type ImplementationState = "runnable" | "partial" | "explanation-only" | "planned";

export type DeclaredStatus = "runnable" | "partial" | "explanation-only" | "planned";

/**
 * 規則そのもの。マニフェストにも registry にも触らない純関数。
 *
 * ★ 純関数として切り出してある理由:
 *   以前はこの規則を「registry に無い lacam は planned へ落ちる」という形で
 *   テストしていたが、lacam が実装された時点でそのテストは成り立たなくなり、
 *   バッチ登録の確認テストへ置き換えられて規則の検査が消えた。
 *   どの手法が実装済みかに依存しない形にしておけば、以後のバッチで
 *   同じことは起きない。
 */
export function resolveImplementationState(
  declared: DeclaredStatus,
  registered: boolean,
): ImplementationState {
  if (registered) {
    // 動きはするが原論文の全機能ではない、という宣言は格上げしない。
    return declared === "partial" ? "partial" : "runnable";
  }
  // registry に無いなら動かない。「解説のみ」だけは意図的な状態なので残す。
  return declared === "explanation-only" ? "explanation-only" : "planned";
}

export function implementationStateOf(algorithmId: string): ImplementationState {
  return resolveImplementationState(
    getAlgorithm(algorithmId)?.implementation_status ?? "planned",
    RUNNABLE_ALGORITHM_IDS.includes(algorithmId),
  );
}

/** シミュレータで動かせるか。partial も動く点に注意。 */
export function isRunnable(algorithmId: string): boolean {
  const state = implementationStateOf(algorithmId);
  return state === "runnable" || state === "partial";
}
