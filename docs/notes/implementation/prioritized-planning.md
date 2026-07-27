# 優先順位付き計画（Prioritized Planning）

- algorithm-id: `prioritized-planning`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

one-shot MAPF。全エージェントに固定した全順序を与え、高優先度から順に、既計画経路と衝突しない個別最短経路を求める。サイト既定の vertex conflict / edge-swap conflict と任意の following conflict を扱う。

## 原論文

- paper-id: `pbs-aaai-2019`、`cooperative-pathfinding-2005`
- 参照した節: Prioritized Planning、Theoretical Results、Cooperative A*
- 参照したページ: PBS PDF pp.1-3、Silver PDF p.2
- 参照した Algorithm 番号: 固定順方式に番号付き Algorithm はない

## 状態表現

高レベルは固定 priority order、計画済み `TimedPath[]`、予約表。低レベルは `(cell, time)` の A*。

## 遷移

優先度順に 1 体ずつ低レベル探索を実行し、得た経路を予約表へ追加する。後続エージェントは高優先度エージェントを動的障害物として避ける。失敗しても別の優先順位は試さない。

## 目的関数

各低レベル探索は、その時点の予約表のもとで対象エージェントの到着時刻を最小化する。全体の flowtime / sum of costs や makespan の最適化は保証しない。

## ヒューリスティック

固定障害物だけを考えた true distance。優先順位付き計画の定義は低レベルの admissible heuristic を特定しないため、決定的で強い許容ヒューリスティックとして選ぶ。

## 終了条件

全エージェントの経路が得られれば成功。あるエージェントで経路が見つからなければ `failureReason: priority-order`。上限、中断、タイムアウトも構造化して返す。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                                                                 |
| ---------- | ---- | ---------------------------------------------------------------------------------------------------- |
| 完全性     | なし | PBS PDF p.2 Theorem 1: arbitrary priority ordering の prioritized planning は一般 MAPF で incomplete |
| 最適性     | なし | PBS PDF p.2「It does not offer completeness or optimality guarantees」、p.3 Theorem 4 / Corollary 5  |
| 準最適保証 | なし | 同論文の 4% は PDF p.7 の実験観測であり、係数保証ではない                                            |

### 保証が成立する条件

PBS PDF p.3 Theorem 3 は well-formed MAPF instances なら任意の total priority ordering で complete とする条件付き結果を示す。ただし一般 MAPF に対する実装 metadata は incomplete とする。

## タイブレーク

既定 priority order は `scenario.agents` の順。`options.extra.priorityOrder` が全エージェント ID の正しい順列ならそれを使う。低レベル A* は `f` 昇順、`g` 降順、生成順。論文は同コスト経路のタイブレーク次第で解けなくなる例を PBS PDF p.3 Theorem 6 後に示すため、今回の規則を明記する。

## 論文中で未指定の箇所

- 汎用 Solver における既定のエージェント順
- 同コスト個別経路のタイブレーク
- 有限 horizon とブラウザ上限

## 公開実装との差異

|                          | 方式                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | predefined total priority ordering で個別最短路を順次計画                                                                                                                 |
| 公開実装で採用された方式 | `libmultirobotplanning` の MAPF 例は SIPP を配列順に呼ぶ。`pibt2` HCA は距離の長い agent を先にし、start/goal 回避の tie-break を追加。PBS 実装は部分順序を探索する別手法 |
| 今回のブラウザ実装       | 配列順または明示 `priorityOrder`。低レベルは Space-Time A*                                                                                                                |
| 差異を選んだ理由         | 固定順方式と PBS、Silver の HCA* を混同せず、順序依存を再現可能にするため                                                                                                 |

## 今回の実装方針

予約表を共有する共通 coordinator を使うが、priority order と低レベル heuristic の選択を明示する。成功時は全経路に共通不変条件を適用する。失敗は「解なし」ではなく「この順序では未発見」と警告する。

## 必要なテスト

- 通常の swap-conflict を解く
- 退避場所を中央へ移した既知例で、オラクルは解あり・固定順は失敗
- priorityOrder を逆転すると結果が変わる例
- `set-priority` / `reserve` / `finish`
- 決定性、中断、タイムアウト、入力上限

## 未対応機能

- 優先順位の探索（PBS）
- ランダム restart、局所順序、動的 priority
- 一般 MAPF に対する完全性・最適性
