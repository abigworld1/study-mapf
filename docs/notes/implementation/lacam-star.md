# LaCAM*（LaCAM star）

- algorithm-id: `lacam-star`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

one-shot MAPF。configuration graph 上の pathfinding として定式化し、vertex conflict と edge collision を禁止する。ブラウザ版は 4 近傍 unit-cost grid、following conflict 許可、stay-at-goal に限定する。

## 原論文

- paper-id: `lacam-star-ijcai-2023`
- 参照した節: §2.1 Notation, Problem Definition, and Assumption、§2.2 LaCAM、§2.3 PIBT、§3 LaCAM*: Eventually Optimal Algorithm、§4 Improving Configuration Generator
- 参照したページ: PDF pp.1–5
- 参照した Algorithm 番号: Algorithms 1–3（PDF pp.3–4）。Algorithm 4 の PIBT swap はブラウザ版の対象外。

## 状態表現

LaCAM の node に、有向 `neighbors`、start からの累積遷移 cost `g`、許容 heuristic `h` を加える。`parent` は現在判明している最短 path tree を表す。goal node は初解発見後も保持する。

## 遷移

LaCAM と同じ lazy successor generation を続ける。新 configuration なら親辺と `g` を付けて登録する。既知 configuration を再発見したら source から既知 node への有向辺を追加し、source から Dijkstra relaxation を行って到達可能な子孫の `g` と `parent` を更新する。goal 発見後も、`g(goal) <= g(node)+h(node)` の node を枝刈りしながら OPEN が空になるまで探索する。

## 目的関数

原論文が実験と Algorithm 3 で採用する **sum-of-loss** を最小化する。遷移 `(X,Y)` の cost は、`X[i]` と `Y[i]` の両方が agent `i` の goal である場合だけ 0、それ以外は 1 を全 agent で合計する。PDF p.2 は一般の累積遷移 cost に保証を与え、flowtime / sum-of-costs は履歴依存なので configuration だけではそのまま表せないと明記する。

サイト共通 `metrics.sumOfCosts` は path から「最後に goal に居続け始める時刻」を再計算するため、goal に滞在後また離れる path では内部 sum-of-loss と一致しないことがある。ブラウザ版の最適化保証は内部 sum-of-loss に対するもので、表示 SOC に対する保証ではない。

## ヒューリスティック

各 agent の現在位置から goal までの graph shortest distance の和。PDF p.2 が sum-of-loss / sum-of-fuels に対する admissible heuristic の例として示す。

## 終了条件

OPEN が空で goal node があれば、探索済み configuration graph に全可能 path が含まれ、sum-of-loss 最適解を返す。goal が無ければ no-solution。timeout / node limit / AbortSignal / path-length limit で中断したとき、incumbent があれば path を保持して中断 outcome を返すが、最適とは表示しない。

## 理論保証

| 項目       | 値                 | 根拠（原文とページ）                                                                                                                                                        |
| ---------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完全性     | あり               | PDF p.4 Theorem 1 は Algorithm 3 を complete とする。各 node が全 connected configuration を最終的に調べる有限探索に基づく。                                                |
| 最適性     | eventually optimal | PDF p.4 Theorem 1 は累積遷移 cost に対して complete and optimal。ただし Algorithm 3 lines 27–28 は OPEN 完了時のみ optimal、user interruption 時は sub-optimal と明記する。 |
| 準最適保証 | なし               | 中断時 incumbent に定数の suboptimality bound は与えられていない。                                                                                                          |

### 保証が成立する条件

非負の累積遷移 cost、admissible heuristic、すべての connected configuration を最終的に列挙する generator、OPEN exhaustion まで中断しないこと。ブラウザ版では timeout / node limit / path-length cutoff に達した結果は保証対象外。最適性の対象は sum-of-loss であり、サイト表示 SOC ではない。

## タイブレーク

Algorithm 3 は高レベル stack と低レベル BFS を指定するが、Dijkstra 内の同 cost、候補 cell、low-level child order の同点順を指定しない。ブラウザ版は seed 付き固定 tie rank、次に config ID / cell index を使う。等 cost の parent は既存のままにし、strict improvement のみ rewiring する。

## 論文中で未指定の箇所

- user interruption を SolverResult の outcome と incumbent path へどう写すか。
- 同一 `g` の複数 parent の選択。
- browser safety limit 下での最適性表示。
- Algorithm 3 の `cost` とサイト共通 metrics の異なる名前空間。

## 公開実装との差異

|                          | 方式                                                                                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | Algorithm 3 の goal 保持、既知辺追加、Dijkstra rewiring、admissible `f` 枝刈り。generator は Algorithm 2 の PIBT、§4 / Algorithm 4 で swap enhancement を提案。                                                                                                 |
| 公開実装で採用された方式 | `Kei18/lacam2` commit `61a4c40c...` は PIBT swap と random reinsertion を含むが submodule 未取得。`Kei18/pylacam` commit `864a158f...` の main branch は教材用に PIBT を random action selection へ置換し、distance 降順 order を用いる。ともに MIT、参照のみ。 |
| 今回のブラウザ実装       | Algorithm 3 の graph / rewiring 構造と sum-of-loss cost を独立実装。generator は LaCAM と共通の PIBT 型 priority inheritance を使用するが Algorithm 4 の corridor swap detector、random restart、LaCAM3 engineering は含めない。                                |
| 差異を選んだ理由         | eventually-optimal の核である「lazy graph discovery + rewiring」を保ちつつ、ブラウザで検証可能な依存なし実装にするため。swap detector は初解速度の改善であり Theorem 1 の必要条件ではない。                                                                     |

## 今回の実装方針

LaCAM と低レベル queue / generator を共有する。既知 configuration への directed edge を重複なく保存し、binary min-heap で relaxation する。rewire と incumbent 更新を event に出す。完全 exhaust した小規模 instance では内部 sum-of-loss の optimum を独立 oracle で確認し、表示 SOC との意味差はテストと解説に固定する。

## 必要なテスト

- 小規模 instance を OPEN exhaustion まで実行し、内部目的と oracle の関係を確認。
- 初解後も探索を続け、rewire / incumbent update event を出す。
- 中断時に incumbent を保持しつつ outcome を timeout / node-limit にする。
- LaCAM と共通の path validity、決定性、rule / input / trace guard。
- goal を一度離れる path で sum-of-loss と表示 SOC を混同しない説明を固定する。

## 未対応機能

- Algorithm 4 の PIBT swap detector、random restart、LaCAM3 の engineering / post-processing。
- 一般 graph file、複数 optimization metric の UI 選択。
- 大規模 MAPF benchmark と lacam2 の同一条件比較。

## 検証結果

- `tests/unit/batch5-solvers.test.ts`: OPEN exhaustion、rewiring / incumbent event、SOC oracle と一致する 3×2 fixture、決定性、安全弁、rule guard。
- `pylacam` commit `864a158f...` の公式 3×2 fixture を seed 0 / refinement 有効で実行し、success、sum-of-loss 6、makespan 4、path validity が一致した。環境に無い `loguru` は実行時だけ無作用 stub とし、repository は変更していない。
- `lacam2` commit `61a4c40c...` は `argparse` / `googletest` submodule 未取得のため CMake configure 不能。
- marker fidelity check は要確認 0。累積 transition cost、Algorithms 1–4、Theorem 1 は PDF pp.2–5 を目視確認した。
