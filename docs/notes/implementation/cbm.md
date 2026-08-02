# CBM（Conflict-Based Min-Cost-Flow）

- algorithm-id: `cbm`
- 調査日: 2026-08-01
- 担当: Codex

## 対象問題

TAPF。チームごとに同数の target があり、チーム内は匿名、チーム間は別 commodity として衝突を解消する。

## 原論文

- paper-id: `cbm-tapf-aamas-2016`
- 参照した節: §2.1、低レベル min-cost max-flow、高レベル CBS
- 参照したページ: pp.1–2, 5–6
- 参照した Algorithm 番号: PDF の CBM high-level / low-level pseudocode

## 状態表現

high-level node はチーム別の vertex/edge constraint と各チームの path set。low-level は team の time-expanded flow。

## 遷移

衝突を検出し、関係するチームの一方へ constraint を追加して再計画する。

## 目的関数

**makespan**。`SolverResult.objective` は必ず `"makespan"`。CBS-TA の SOC と直接比較しない。

## ヒューリスティック

各 agent start から自チーム target への Manhattan 下界を horizon の初期値に使う。high-level は FIFO の決定的探索。

## 終了条件

衝突の無い全チーム path が得られた最小 horizon。timeout / node limit は no-solution の証明ではない。

## 理論保証

| 項目       | 値                 | 根拠（原文とページ）                                            |
| ---------- | ------------------ | --------------------------------------------------------------- |
| 完全性     | あり（論文条件下） | p.2 の TAPF 定義と p.6「CBM is correct, complete and optimal.」 |
| 最適性     | 最適（makespan）   | p.2「minimal makespan」、p.6 Theorem 3。                        |
| 準最適保証 | なし               | —                                                               |

### 保証が成立する条件

TeamSpec の equal target count、4 近傍・離散時間・指定した vertex/edge conflict、十分な horizon と探索資源。

## タイブレーク

論文で high-level の同順位処理は未指定。チーム順、constraint 追加順、FIFO を採用。

## 公開実装との差異

|                          | 方式                                                                             |
| ------------------------ | -------------------------------------------------------------------------------- |
| 論文で定義された方式     | team low-level min-cost max-flow + team-level CBS。                              |
| 公開実装で採用された方式 | libMultiRobotPlanning は CBS-TA の参照に用い、CBM の固定比較対象にはしていない。 |
| 今回のブラウザ実装       | 独立 MCMF と CBS high-level。                                                    |
| 差異を選んだ理由         | Worker 用の依存ゼロ実装と既存 Solver API への適合。                              |

## 今回の実装方針

`src/solvers/tapf/team-flow.ts` と `src/solvers/tapf/cbm.ts`。小規模 TAPF プリセットで tapf-baseline と makespan を照合する。

## 必要なテスト

3 TAPF プリセット、チーム内匿名割当、チーム間 vertex/edge conflict、baseline makespan 一致、決定性。

## 未対応機能

論文の全最適化・高度な low-level tie-break、巨大チーム、連続時間、ECBS-TA。
