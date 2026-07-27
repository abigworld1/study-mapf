import type { Scenario, SolverOptions, SolverResult, SolverWarning } from "@/lib/model/types.js";
import { emptyResult } from "./shared.js";

/**
 * 入力が大きすぎないかの検査。
 *
 * ★ ブラウザ内で動く教材なので、入力次第でタブごと固まる。
 *   Solver は探索を始める前に必ずこれを呼び、超えていたら即座に返すこと。
 *   「動かしてみて重かったら止める」では遅い。
 */
export interface LimitCheck {
  readonly ok: boolean;
  /** ok が false のときに返すべき結果。 */
  readonly result?: SolverResult;
  /** ok でも付けるべき注意（上限に近い等）。 */
  readonly warnings: readonly SolverWarning[];
}

export function checkLimits(scenario: Scenario, options: SolverOptions): LimitCheck {
  const warnings: SolverWarning[] = [];
  const area = scenario.map.width * scenario.map.height;
  const agents = scenario.agents.length;

  const violations: string[] = [];
  if (agents > options.maxAgents) {
    violations.push(`エージェント数 ${agents} が上限 ${options.maxAgents} を超えています`);
  }
  if (area > options.maxGridArea) {
    violations.push(
      `グリッド面積 ${area}（${scenario.map.width}×${scenario.map.height}）が上限 ${options.maxGridArea} を超えています`,
    );
  }
  if (options.horizon !== undefined && options.horizon > options.maxHorizon) {
    violations.push(`horizon ${options.horizon} が上限 ${options.maxHorizon} を超えています`);
  }

  if (violations.length > 0) {
    return {
      ok: false,
      warnings,
      result: {
        ...emptyResult("error", 0, {
          code: "invalid-scenario",
          message: `入力が大きすぎます。${violations.join(" / ")}`,
        }),
        failureReason: "limit-exceeded",
        warnings: [{ code: "input-too-large", message: violations.join(" / ") }],
      },
    };
  }

  // 上限の 7 割を超えたら、重くなる可能性を先に伝える。
  if (agents > options.maxAgents * 0.7 || area > options.maxGridArea * 0.7) {
    warnings.push({
      code: "input-too-large",
      message:
        "入力が大きめです。ブラウザ内で動かすため、実行に時間がかかるか途中で打ち切られることがあります。",
    });
  }

  return { ok: true, warnings };
}

/**
 * トレースの詳細度に応じて、そのイベントを記録すべきかを判定する。
 *
 * summary  : 進捗と結果、構造の節目だけ
 * detailed : 上記 + 制約・優先順位・衝突・タスクの動き
 * verbose  : すべて（ノード展開まで）
 */
const SUMMARY_EVENTS = new Set<string>([
  "progress",
  "finish",
  "move",
  "detect-conflict",
  "accept-solution",
  "update-incumbent",
  "assign-task",
  "pickup",
  "delivery",
]);

const DETAILED_EXTRA = new Set<string>([
  "reserve",
  "add-constraint",
  "set-priority",
  "inherit-priority",
  "backtrack",
  "destroy-neighborhood",
  "repair-neighborhood",
  "classify-conflict",
  "create-ct-node",
  "low-level-replan",
  "bypass",
  "update-priority-dag",
  "replan-lower-priority-agent",
  "priority-order",
  "candidate-evaluation",
  "create-ict-node",
  "build-mdd",
  "prune-ict-node",
  "update-collision-set",
  "backpropagate-collision",
  "push-agent",
  "clear-vertex",
  "swap-agents",
  "rotate-cycle",
  "create-subproblem",
  "configuration-expand",
  "add-lazy-constraint",
  "configuration-generate",
  "select-neighborhood",
  "reject-solution",
  "release-task",
  "swap-task",
  "update-token",
  "replan",
  "discover-safe-interval",
]);

export function shouldRecord(eventType: string, level: SolverOptions["traceLevel"]): boolean {
  if (level === "off") return false;
  if (level === "verbose") return true;
  if (SUMMARY_EVENTS.has(eventType)) return true;
  if (level === "detailed") return DETAILED_EXTRA.has(eventType);
  return false;
}
