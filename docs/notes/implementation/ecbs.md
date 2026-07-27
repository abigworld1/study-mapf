# ECBS（Enhanced CBS）

- algorithm-id: `ecbs`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

one-shot MAPF、sum of costs。サイト上の rule 対応範囲は CBS と同じ。

## 原論文

- paper-id: `bcbs-ecbs-socs-2014`
- 参照した節: “Enhanced CBS”
- 参照したページ: PDF p.6
- 参照した Algorithm 番号: basic CBS は Algorithm 1（PDF pp.3–4）。ECBS の変更は PDF p.6 の数式で定義

## 状態表現

CT node は paths、constraints、`cost(N)` に加えて、各 low-level OPEN の最小 f の和 `LB(N)` を持つ。

## 遷移

low level は `BCBS(1,w)` と同じ focal search。high-level OPEN の全 node に対する `LB=min LB(N)` を求め、`cost(N) <= w*LB` の node を FOCAL に入れ、path 集合の conflict 数で選ぶ。

## 目的関数

sum of costs。`SolverOptions.suboptimalityFactor` を `w` とする。

## ヒューリスティック

低レベルは true distance と CAT conflict count。高レベルの下界は各 agent の low-level `fMin` の和。

## 終了条件

FOCAL から選んだ CT node が conflict-free なら solved。その他の停止条件は CBS と同じ。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                                                   |
| ---------- | ---- | -------------------------------------------------------------------------------------- |
| 完全性     | あり | `bcbs-ecbs-socs-2014` PDF p.6 “Thus, BCBS and ECBS are complete.”                      |
| 最適性     | なし | bounded-suboptimal 版                                                                  |
| 準最適保証 | あり | PDF p.6: FOCAL の全 node は optimal cost の `w` 倍以内で、返却 solution も `w*C*` 以下 |

### 保証が成立する条件

`w>=1`、admissible low-level f、low-level focal path cost が `w*fMin` 以下、high-level が `LB` を定義どおり更新すること。安全上限で打ち切った実行は対象外。

## タイブレーク

FOCAL は conflict 数、cost、生成順。低レベルは conflict 数、f、g 降順、生成順。

## 論文中で未指定の箇所

完全同値 node の順。今回の生成順は FIFO。

## 公開実装との差異

|                          | 方式                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | low-level `fMin` の和を CT 下界とする 2-level focal search                                                          |
| 公開実装で採用された方式 | `libmultirobotplanning` commit `4c75fa20...`（MIT）は `LB` と conflict heuristic を保持し、FOCAL 同値を cost で解く |
| 今回のブラウザ実装       | 独立 TypeScript 実装。active CT node から厳密に `min LB(N)` を再計算し、明示的 FIFO を加える                        |
| 差異を選んだ理由         | 教材上 lower bound の由来を追跡しやすくし、決定性を保証するため                                                     |

公開実装のコードは転記していない。

## 今回の実装方針

bounded low-level planner と CBS core を共有し、root / child の各 replan から `fMin` を保存する。

## 必要なテスト

- certified oracle に対する `cost <= w*C*`
- metrics.lowerBound と suboptimalityBound
- `w=1` で最適 cost
- path 不変条件、決定性、trace

## 未対応機能

ECBS 後年実装の symmetry reasoning、heuristic enhancements、disjoint splitting、無限 horizon。
