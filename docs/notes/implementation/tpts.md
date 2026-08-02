# TPTS（Token Passing with Task Swaps）

- algorithm-id: `tpts`
- 調査日: 2026-08-02
- 担当: Codex

## 対象問題

lifelong MAPD。TP の token / Path1 / Path2 を共有し、GetTask に task swap を加える。

## 原論文

- paper-id: `mapd-tp-tpts-central-2017`
- 参照した節: §4.2
- 参照したページ: PDF p.4–5
- 参照した Algorithm 番号: Algorithm 2、Property 4、Theorem 5

## 状態表現

TP と同じ token に、unexecuted task の agent assignment を持つ。未 pickup の assignment は候補として比較する。

## 遷移

GetTask は h 値順に task を調べ、未割当なら Path1、別 agent が未 pickup で割当済みなら unassign → Path1 → pickup 到達時刻比較 → 再帰的に元 agent を再計画する。

## 目的関数

service time / makespan。サイトでは共通ループの指標を返す。

## ヒューリスティック

current location から pickup までの h 値。低レベルは MLA*。

## 終了条件

全 task delivery、またはループの horizon / timeout。

## 理論保証

| 項目       | 値       | 根拠（原文とページ）                                             |
| ---------- | -------- | ---------------------------------------------------------------- |
| 完全性     | 条件付き | PDF p.5 Theorem 5「TPTS solves all well-formed MAPD instances.」 |
| 最適性     | 不明     | Theorem 5 は solvability のみ。                                  |
| 準最適保証 | なし     | 有界準最適性の主張はない。                                       |

### 保証が成立する条件

well-formed 前提。非 well-formed の警告は runMapdLoop に任せる。

## タイブレーク

h 値、task id、agent id の順。論文に同点規則はない。

## 論文中で未指定の箇所

再帰的な token 返却順、同点 h 値、A* の同点順は未指定。

## 公開実装との差異

|                          | 方式                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 論文で定義された方式     | TP と同じ main loop / Path1 / Path2、未 pickup task の swap、再帰的 GetTask。                                                                                                                                |
| 公開実装で採用された方式 | 第三者コードは転記せず、挙動を独立に再構成。                                                                                                                                                                 |
| 今回のブラウザ実装       | TP の共通 strategy を使い、同一 step の暫定割当に加えて、前 step から carrying 中だが未 pickup の task も `assign` で奪う。loop が swap-task を発火し、old owner は token から外して同じ step に再計画する。 |
| 差異を選んだ理由         | 拡張された `MapdStepOutput.assign` が pickup 前の奪い取りを安全に強制するため。pickup 済みの task は loop が拒否する。                                                                                       |

## 今回の実装方針

TP の共通 token strategy を TPTS モードで動かす。交換時は strategy が `assign` だけを返し、loop が old owner の carrying を外して `swap-task` を 1 件出す。候補 agent の pickup までの決定的な距離が old owner より厳密に短い場合だけ奪い、old owner は Path2 または別 task を同じ step に試す。

## 必要なテスト

- well-formed 完了、非 well-formed 警告
- same-step の一意な delivery
- 前 step の未 pickup task の奪い取り、loop の `swap-task`、TP との差
- token collision-free、決定性
- TP と同じ service time 計測規則

## 未対応機能

論文の再帰的 GetTask を完全に同じ通信順で再現するのではなく、ブラウザ版は 1 step の queue に old owner を戻す。pickup までの比較は true distance の deterministic な下界比較で、full path cost を使う原実装の細部、分散通信、無限 task stream は扱わない。
