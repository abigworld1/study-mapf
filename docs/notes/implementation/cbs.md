# CBS（Conflict-Based Search）

- algorithm-id: `cbs`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

one-shot MAPF。原論文と同じく離散時間の graph 上で move / wait を行い、sum of costs を最小化する。本サイトでは 4 近傍グリッド、vertex conflict と edge-swap conflict、stay at goal を扱う。following conflict、斜め移動、disappear at goal は対象外として入力時に拒否する。

## 原論文

- paper-id: `cbs-aij-2015`（定義・疑似コード・証明）、`cbs-aaai-2012`（先行版）
- 参照した節: `cbs-aij-2015` §§4.1–4.3, §§5.1–5.2
- 参照したページ: PDF pp.8–13
- 参照した Algorithm 番号: Algorithm 2（PDF p.10。MA-CBS 部分の lines 11–18 は CBS では無効）

## 状態表現

高レベルは constraint tree (CT) node。各 node は累積制約、各 agent の制約整合 path、SOC、生成順を持つ。低レベルは `(cell, time)`。

## 遷移

最初の conflict を 2 本の negative constraint に分け、各 child では制約対象 agent だけを再計画する。vertex conflict は `(agent, cell, time)`、edge-swap conflict は禁止される向きの `(agent, from, to, arrivalTime)` に変換する。

## 目的関数

sum of costs。各 agent の最終 goal 到達時刻の和。

## ヒューリスティック

低レベル A* は障害物を考慮した goal からの true distance を admissible heuristic に使う。同じ最短コスト内では conflict avoidance table (CAT) に相当する「他 path との累積 conflict 数」を優先する。

## 終了条件

OPEN から取り出した CT node の path 集合に conflict がなければ solved。OPEN が空なら no-solution。ブラウザ版ではさらに timeout、展開上限、`maxHorizon`、AbortSignal で停止する。

## 理論保証

| 項目       | 値       | 根拠（原文とページ）                                                                                                        |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| 完全性     | 条件付き | `cbs-aij-2015` PDF p.12 Theorem 3 は「解が存在すれば返す」。PDF p.13 §5.2.2 は解なし判定は CBS 単体では常に成立しないと明記 |
| 最適性     | 最適     | `cbs-aij-2015` PDF p.12 Theorem 1 “CBS returns an optimal solution.”                                                        |
| 準最適保証 | なし     | 最適解法であり、bounded-suboptimal 版ではない                                                                               |

### 保証が成立する条件

低レベルが各制約集合に対する最短 path を返し、高レベルが CT node を SOC の best-first で選ぶこと。有限 graph、非負の単位コスト、解が存在する場合。ブラウザ版の有限 `maxHorizon`、timeout、node limit に達した実行は保証の対象外。

## タイブレーク

論文は高レベルを SOC、conflict 数、FIFO の順、低レベル同値を CAT で選ぶ（PDF pp.8, 11）。今回もこの順を採用し、さらに完全同値は agent 配列順・cell の列挙順・生成順で決定する。

## 論文中で未指定の箇所

複数の「最初の conflict」が同時刻にある場合の agent 対順序。今回は `detectConflicts()` の時刻昇順、agent 配列順を用いる。edge constraint の `time` はサイト型に合わせて到着時刻とする。

## 公開実装との差異

|                          | 方式                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | binary CT、最短 single-agent low level、SOC best-first、CAT tie-break                                                                                               |
| 公開実装で採用された方式 | `libmultirobotplanning` commit `4c75fa20...`（MIT）は earliest conflict と A* を使い、CT heap の比較は cost のみ。`cbsh2-rtc` 等は USC 独自ライセンスなので閲覧のみ |
| 今回のブラウザ実装       | 独立 TypeScript 実装。論文の SOC/conflict/FIFO と CAT を明示し、共通イベントと安全上限を追加                                                                        |
| 差異を選んだ理由         | 決定性と論文記載の tie-break を保ち、Web Worker で停止可能にするため                                                                                                |

公開実装のコードは転記していない。

## 今回の実装方針

制約付き focal A* を共通 low level として作り、weight=1 で CBS の最短探索にする。CT child は親の paths を複製せず immutable 配列として差し替える。全探索で 1 つの展開予算と clock を共有する。

## 必要なテスト

- `checkPaths()` による path 不変条件
- 極小問題で `jointStateOptimalSumOfCosts()` と SOC を比較
- vertex / edge-swap constraint の分岐
- deterministic tie-break、abort、timeout、node limit、trace
- 解なしまたは horizon 内に解けない場合の構造化結果

## 未対応機能

positive constraint / disjoint splitting、MA-CBS、following conflict、diagonal、disappear at goal、有限 horizon を越える探索。
