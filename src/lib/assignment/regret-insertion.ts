import type { AgentId, TaskSpec } from "@/lib/model/types.js";

/**
 * RMCA の marginal-cost / regret ordering の小さな純関数実装。
 * 各 task について最良と次善の agent cost の差を計算し、regret の大きい
 * task から挿入する。挿入先そのものは caller が決めるため、MAPD ループへ
 * 副作用を持たない。原論文の priority heap 全体を置き換える教育用部品。
 */
export function regretInsert(
  tasks: readonly TaskSpec[],
  agents: readonly { readonly id: AgentId }[],
  cost: (task: TaskSpec, agent: { readonly id: AgentId }) => number,
): readonly TaskSpec[] {
  return [...tasks].sort((a, b) => {
    const regret = (task: TaskSpec): number => {
      const values = agents
        .map((agent) => cost(task, agent))
        .filter((value) => Number.isFinite(value))
        .sort((x, y) => x - y);
      if (values.length < 2) return values[0] ?? Number.POSITIVE_INFINITY;
      return values[1]! - values[0]!;
    };
    return regret(b) - regret(a) || a.releaseTime - b.releaseTime || a.id.localeCompare(b.id);
  });
}
