# LaCAM（Lazy Constraints Addition search for MAPF）

- algorithm-id: `lacam`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

one-shot MAPF。原論文とサイト既定はいずれも、離散時間の graph 上で move / wait を行い、vertex conflict と edge-swap conflict を禁止する。ブラウザ版は 4 近傍 unit-cost grid、following conflict 許可、stay-at-goal に限定する。

## 原論文

- paper-id: `lacam-aaai-2023`
- 参照した節: §2 Preliminaries、§3.1 Concept、§3.2 Pseudocode、§3.3 Implementation Details
- 参照したページ: PDF pp.1–4
- 参照した Algorithm 番号: Algorithm 1（PDF p.3）

## 状態表現

高レベル node は全 agent の位置 tuple である configuration、親 node、agent order、低レベル constraint tree を持つ。低レベル node は root からの経路により「次 configuration で agent `i` を vertex `v` に置く」という部分制約を表す。既知 configuration は `Explored` table で一意化する。

## 遷移

高レベルは stack による DFS、各高レベル node 内の低レベル探索は queue による BFS。低レベル node を 1 個取り出すたびに、その制約を満たす connected configuration を generator で 1 個だけ生成する。低レベル tree の深さが agent 数に達すると全 agent の次位置が明示されるため、すべての connected configuration が最終的に列挙される。

## 目的関数

LaCAM は最適化順序を持たず、最初に見つけた solution を返す sub-optimal search。論文は解品質の評価に sum-of-costs（各 agent が最終的に goal に居続け始める時刻の和）を用いるが、Algorithm 1 はこれを最小化しない。

## ヒューリスティック

configuration generator では各 goal からの graph true distance を用い、PIBT 型の 1-step assignment で goal に近い候補を優先する。高レベル OPEN の順序自体は DFS であり、`f` 値は使わない。

## 終了条件

goal configuration を stack top で選択したら親を backtrack して solved。各高レベル node の低レベル queue をすべて消費し、OPEN が空なら no-solution。ブラウザ版では timeout、max expansions、AbortSignal、最大 path length の安全弁でも停止する。安全弁による停止は解不存在の証明ではない。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                                                                                            |
| ---------- | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| 完全性     | あり | PDF p.3 Theorem 1: solvable instance では solution、そうでなければ `NO_SOLUTION` を返す。有限な高・低レベル空間の全列挙で示す。 |
| 最適性     | なし | PDF p.1 は本文の対象を “sub-optimal LaCAM” と明記し、Algorithm 1 は goal 発見時に最初の解を返す。                               |
| 準最適保証 | なし | 解コストに対する定数 bound は与えられていない。                                                                                 |

### 保証が成立する条件

configuration generator が指定された部分制約を守り、低レベル tree の全制約を最終的に処理すること。timeout、node limit、ブラウザ版の最大 path length で中断しないこと。原論文の collision 定義に従うこと。

## タイブレーク

論文は初期 agent order を start-goal distance 降順、後続 node を goal 外に長くいた agent 優先とする。低レベル子の挿入順は random とするが、同距離候補の最終順は未指定。ブラウザ版は `context.random()` から固定 tie rank を作り、同一 seed で再現可能な順序にする。cell index を最後の決定的 tie-break にする。

## 論文中で未指定の箇所

- configuration generator が失敗した場合の内部 backtracking と残り同点順。
- browser 向け timeout / expansion / path-length limit の値。
- trace event と expanded / generated node の計測単位。

## 公開実装との差異

|                          | 方式                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 論文で定義された方式     | Algorithm 1 の高レベル DFS、低レベル BFS、lazy constraint、PIBT generator。既知 configuration の再挿入は §3.3 の実装上の改善。                                                                                           |
| 公開実装で採用された方式 | `Kei18/lacam0` commit `3153c980...` は LaCAM* rewiring、random restart、PIBT swap、hindrance 等も含む統合実装。`ANYTIME=false` で初解停止にできる。MIT、参照のみでコードは転記しない。                                   |
| 今回のブラウザ実装       | Algorithm 1 の素の `Explored` 処理を採用し、PIBT 型 generator は true distance、priority inheritance、rollback 可能な assignment で独立実装する。LaCAM* の rewiring / restart / swap enhancement は LaCAM 側へ混ぜない。 |
| 差異を選んだ理由         | LaCAM と LaCAM* の教材上の差を保ち、Algorithm 1 の完全性を担う lazy enumeration を直接観察できるようにするため。公開実装の後年の engineering feature は別アルゴリズムの挙動を混ぜるため除外する。                        |

## 今回の実装方針

configuration を cell index 配列で表し、configuration key で一意化する。各高レベル node は独立の低レベル FIFO を持つ。full constraint leaf では exact transition validity を検査するため、heuristic generator が部分制約で失敗しても全列挙による完全性の構造を保つ。`configuration-expand`、`create-low-level-node`、`add-lazy-constraint`、`configuration-generate` と generator 内の priority inheritance / backtrack を発火する。

## 必要なテスト

- 退避を要する 2-agent instance と fully occupied cycle で solved、`checkPaths()`。
- unsolvable な 2-cell swap を OPEN exhaustion で no-solution。
- lazy constraint event と低レベル BFS の存在。
- 同一 seed の決定性、timeout、node limit、AbortSignal、input / rule / trace guard。
- 最大 path length を切った失敗が no-solution 証明にならないこと。

## 未対応機能

- 一般 graph file の直接入力、following-conflict 禁止、disappear-at-goal、diagonal grid。
- §3.3 の既知 node 再挿入と benchmark 用の大規模 engineering。
- 原論文 benchmark 全件の再現。

## 検証結果

- `tests/unit/batch5-solvers.test.ts`: 3×2 detour swap、2×1 unsolvable edge swap、lazy constraint events、決定性、安全弁、rule guard。
- 5 seed の solved result を `checkPaths()` で検査。
- `lacam0` commit `3153c980...` は `third_party/argparse` submodule 未取得のため CMake configure 不能。後年の機能を含むためコードは転記していない。
- marker fidelity check は要確認 0。Algorithm 1 / Theorem 1 / §3.3 は PDF pp.3–4 を目視確認した。
