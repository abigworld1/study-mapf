# TP（Token Passing）

- algorithm-id: `token-passing`
- 調査日: 2026-08-02
- 担当: Codex

## 対象問題

lifelong MAPF / online MAPD。サイトでは `mapd` Scenario と `runMapdLoop` に適合させる。

## 原論文

- paper-id: `mapd-tp-tpts-central-2017`
- 参照した節: §3.1–3.2、§4.1
- 参照したページ: PDF p.2–4
- 参照した Algorithm 番号: Algorithm 1、Path1、Path2、Property 1–2、Theorem 3

## 状態表現

token は全 agent の現在から先の経路、未割当 task 集合、割当を保持する。agent が token を受け取るたびに task を選ぶか Path2 で non-task endpoint へ退避する。

## 遷移

各 timestep に release 済み task を token へ追加し、deterministic な agent 順で token を渡す。Path1 は pickup → delivery、Path2 は現在地 → delivery を塞がない non-task endpoint。経路は共通 MLA* で計画する。

## 目的関数

論文の評価は service time / makespan。サイトの `metrics.averageServiceTime` と `throughput` は runMapdLoop が計測する。

## ヒューリスティック

task 選択は current location から pickup までの h 値（壁を考慮した距離）、同値は task id。Path1 / Path2 の低レベルは MLA*。

## 終了条件

ループが全 task を delivery したら solved。horizon / timeout で未完了なら timeout。

## 理論保証

| 項目       | 値       | 根拠（原文とページ）                                                                  |
| ---------- | -------- | ------------------------------------------------------------------------------------- |
| 完全性     | 条件付き | PDF p.4 Theorem 3「All well-formed MAPD instances are solvable, and TP solves them.」 |
| 最適性     | 不明     | Theorem 3 は solvability であり cost optimality を主張しない。                        |
| 準最適保証 | なし     | 原論文に有界準最適性の主張はない。                                                    |

### 保証が成立する条件

well-formed は十分条件であって必要条件ではない。ループは非 well-formed 入力に自動警告を出すため、戦略側では重複警告を出さない。

## タイブレーク

論文は agent の token 要求順を固定していない。サイト版は agent id 順、task は h 値、task id 順。

## 論文中で未指定の箇所

queue の同点規則、A* の priority queue 実装、通信の物理遅延は未指定。元論文の TP は sequential A* だが、サイト版は MLA* を低レベルに使う。

## 公開実装との差異

|                          | 方式                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------- |
| 論文で定義された方式     | 明示的 token、Path1 / Path2、A*、well-formed 上の Theorem 3。                      |
| 公開実装で採用された方式 | 本作業ではコードを転記せず、論文の挙動を独立に再構成。                             |
| 今回のブラウザ実装       | token は明示的に保持し、低レベルを MLA* に置換。runMapdLoop の時間順は変更しない。 |
| 差異を選んだ理由         | pickup 待ちの過剰制約を避け、MLA* を共通部品にするため。                           |

## 今回の実装方針

`MapdStrategy` として common token strategy を実装し、`update-token` / `assign-task` を出す。予約表を token の代用にはしない。

## 必要なテスト

- mapd-well-formed を完了
- mapd-not-well-formed ではループの保証対象外警告だけを確認
- token 更新、Path2 退避、衝突なし、決定性
- service time が releaseTime 起点

## 未対応機能

分散通信、動的 task stream の無限実行、論文実装の細かな通信スケジュール。
