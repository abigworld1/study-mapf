# HCA*（Hierarchical Cooperative A*）

- algorithm-id: `hca-star`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

CA* と同じ Cooperative Pathfinding / one-shot MAPF。時空間探索の heuristic を、時間と reservation table を無視した抽象 2D map の距離へ強化する。

## 原論文

- paper-id: `cooperative-pathfinding-2005`
- 参照した節: Hierarchical Cooperative A*
- 参照したページ: PDF pp.2-3
- 参照した Algorithm 番号: Algorithm 1「Reverse Resumable A*」（PDF p.3）

## 状態表現

協調層は `(cell, time)`。抽象層 RRA* は静的 2D grid の `cell`、OPEN、Closed、ゴールからの距離 `g` を各 agent ごとに保持する。

## 遷移

協調層は CA* と同じ move / wait / reservation 検査。抽象層はゴールから逆向きに 4 近傍を展開し、要求された cell が Closed に入るまで探索を再開する。

## 目的関数

各 agent の予約制約下の最短到着時刻。抽象層は予約を無視した goal までの最短距離を返す。MAPF 全体の最適性は目的にしない。

## ヒューリスティック

Silver PDF p.2 は、時間と予約表を無視した抽象距離を admissible かつ consistent とする。Algorithm 1 の RRA* を goal から on-demand に再開し、要求 cell の最短距離を返す。RRA* 自身の heuristic は Manhattan distance。

## 終了条件

CA* と同じ。抽象層が到達不能を確定した場合、その cell の heuristic は infinity。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                                                   |
| ---------- | ---- | -------------------------------------------------------------------------------------- |
| 完全性     | なし | HCA* は CA* の heuristic 強化であり、Silver PDF p.2 の decoupled greedy failure が残る |
| 最適性     | 不明 | 抽象 heuristic の admissible / consistent は明示されるが、MAPF 全体の最適性定理はない  |
| 準最適保証 | なし | 理論的な係数は提示されていない                                                         |

### 保証が成立する条件

抽象距離の許容性は、抽象 map が時間と他 agent だけを除き、実際の静的障害物と移動コストを保つ場合に成立する。固定順方式の一般 MAPF 完全性は成立しない。

## タイブレーク

Silver PDF p.3 は、前向き経路と逆向き RRA* の同値分岐を合わせるため successor ordering を逆転すると説明する。今回の grid 実装は RRA* の `f`、`g`、`y`、`x` の決定的順序を採用し、協調層は `f` 昇順、`g` 降順、生成順を採用する。この選択は一般グラフで論文と同じ分岐を保証しないため差異として残す。

## 論文中で未指定の箇所

- agent ordering
- grid での全方向の厳密な tie reversal
- edge-swap / following
- ブラウザ上限

## 公開実装との差異

|                          | 方式                                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | CA* + agent ごとの on-demand RRA*、抽象 OPEN/Closed の再利用                                                                                                |
| 公開実装で採用された方式 | `pibt2` commit `faab5b9` の HCA は start-goal 距離が長い agent を先にし、他 agent の start/goal を避ける tie-break を持つ。サブモジュール未取得でビルド不可 |
| 今回のブラウザ実装       | agent 順は入力順、RRA* を論文に沿って独立実装、サイト conflict rules を追加                                                                                 |
| 差異を選んだ理由         | CA* との比較で heuristic だけを変え、公開実装固有の priority heuristic を混ぜないため                                                                       |

## 今回の実装方針

`ReverseResumableAStar` を独立クラスにし、協調探索から heuristic が要求されるたびに再開する。agent ごとにインスタンスを保持し、WHCA* の次 window でも再利用できる構造にする。

## 必要なテスト

- RRA* が静的 BFS の true distance と一致
- 同じ goal への複数問い合わせで Closed を再利用
- CA* と同じ解コストで協調層展開数が増えない代表例
- 固定順の不完全例
- 抽象/協調 `expand-node`、決定性、中断、上限

## 未対応機能

- 公開実装の distance-first priority と start/goal tie-break
- 一般有向グラフでの successor ordering reversal
- priority の再探索
