# Cooperative A*（CA*）

- algorithm-id: `cooperative-astar`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

Cooperative Pathfinding / one-shot MAPF。各エージェントが他の計画済み経路を完全に知る分離型手法。固定順で時空間 A* を実行し、経路を reservation table に記録する。

## 原論文

- paper-id: `cooperative-pathfinding-2005`
- 参照した節: Cooperative A*
- 参照したページ: PDF p.2
- 参照した Algorithm 番号: 該当なし

## 状態表現

各低レベル探索は `(cell, time)`。共有データは疎な `(x, y, t)` reservation table と、edge-swap 用の辺予約。

## 遷移

move または wait。予約済み状態へ入る遷移を捨てる。経路が得られたら、その全状態と辺を後続エージェントのために予約する。

## 目的関数

各エージェントについて、既存予約のもとで到着時刻が最小の経路を貪欲に選ぶ。全エージェントの sum of costs / makespan を共同最適化しない。

## ヒューリスティック

Silver PDF p.2 の基本形どおり Manhattan distance。任意の admissible heuristic を使えるが、より強い抽象距離は HCA* として分離する。

## 終了条件

全エージェントの完全経路を予約できれば成功。ある順番で後続エージェントの経路が無ければ priority-order failure。上限・中断・タイムアウトでも終了する。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                                                               |
| ---------- | ---- | -------------------------------------------------------------------------------------------------- |
| 完全性     | なし | Silver PDF p.2 は decoupled greedy algorithm が解けない問題クラスと CA* が解けない Figure 1 を明示 |
| 最適性     | 不明 | 個別経路を最適にする記述はあるが、MAPF 全体の最適性定理は確認できない                              |
| 準最適保証 | なし | 理論的な係数は提示されていない                                                                     |

### 保証が成立する条件

一般 MAPF では完全性なし。良い agent ordering が必要と Silver PDF p.2 に明記される。

## タイブレーク

エージェント順は `scenario.agents`。低レベルは `f` 昇順、`g` 降順、生成順。Silver 論文は「sensible priorities」の必要性を述べるが具体規則を指定しない。

## 論文中で未指定の箇所

- 具体的な agent ordering
- edge-swap / following を別種として扱う方法
- ゴール予約の無限延長を有限ブラウザ horizon へ落とす方法
- 同コスト経路のタイブレーク

## 公開実装との差異

|                          | 方式                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | 固定順の space-time A* と `(x,y,t)` reservation table、Manhattan heuristic                                        |
| 公開実装で採用された方式 | マニフェスト上の `pibt2` には HCA 実装があるが CA* 専用クラスは確認できない。サブモジュール未取得のためビルド不可 |
| 今回のブラウザ実装       | 論文の基本形に edge reservation、ルール検査、trace、停止上限を追加                                                |
| 差異を選んだ理由         | サイト既定の edge-swap 禁止を満たし、教育用に CA* と HCA* の heuristic 差を見せるため                             |

## 今回の実装方針

共通 Space-Time A* と SimpleReservationTable を使う。HCA* と同じ coordinator を共有しても heuristic は Manhattan に固定し、別 Solver として登録する。

## 必要なテスト

- 2 体以上の衝突なし経路
- reservation table の vertex / edge 予約
- CA* の Manhattan と HCA* の abstract heuristic が同じ解コストを保つ小例
- 固定順で失敗する既知例
- イベント、決定性、中断、各種上限

## 未対応機能

- 優先順位探索・再試行
- 連続空間や大きさのある agent の占有領域
- 一般 MAPF の完全性・最適性
