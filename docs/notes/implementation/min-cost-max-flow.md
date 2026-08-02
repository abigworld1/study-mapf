# 最小費用最大流（Min-Cost Max-Flow）

- algorithm-id: `min-cost-max-flow`
- 調査日: 2026-08-01
- 担当: Codex

## 対象問題

1 チーム TAPF（匿名 MAPF）の low-level。時空間ネットワーク上で全 start から全 target へ単位フローを送る。

## 原論文

- paper-id: `network-flow-mapf-2012`（§II, §V） / `cbm-tapf-aamas-2016`（p.2）
- 参照したページ: network-flow-mapf-2012 pp.4, 9
- 参照した Algorithm 番号: 固有の番号なし（time-expanded network と min-cost maximum flow の構成）

## 状態表現

ノード `(cell, time, in/out)`、source、sink。cell の in→out 容量を 1 とし、時刻間の move/wait 辺を張る。

## 遷移

4 近傍 move または wait。move cost は 1、wait cost は 0。固定 horizon の target ノードから sink へ送る。

## 目的関数

固定 horizon 内の最大フローを最小費用にする。ブラウザ Solver は horizon を下界から増やし、最初に全フローが通る horizon（makespan）を返す。

## ヒューリスティック

なし。残余グラフ上の Bellman–Ford による最短増加路を使う。

## 終了条件

要求 flow が送れた時点で成功。horizon / timeout / expansion limit を超えれば構造化失敗を返す。

## 理論保証

| 項目       | 値       | 根拠（原文とページ）                                                                                       |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| 完全性     | 条件付き | network-flow-mapf-2012 p.9 Corollary 23。permutation-invariant MAPF と十分な time horizon の条件。         |
| 最適性     | 条件付き | 同 p.9 Corollary 25。time-expanded network の minimum cost maximum flow が Objective 24 の最適解を与える。 |
| 準最適保証 | なし     | MCMF 自体の bounded-suboptimal 主張は確認していない。                                                      |

### 保証が成立する条件

単一 commodity の匿名モデル、4 近傍の時空間ネットワーク、十分な horizon、整数容量を仮定する。複数チームの結合は CBM が担当する。

## タイブレーク

Bellman–Ford の同コスト辺は始点ノード番号の小さい順。これは論文未指定部分を決定的にするためのサイト規則。

## 論文中で未指定の箇所

具体的な残余グラフ探索実装と同値経路の選択。

## 公開実装との差異

|                          | 方式                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | 時空間ネットワークへ最大流／最小費用流を適用する。                                              |
| 公開実装で採用された方式 | libMultiRobotPlanning は CBS-TA の割当・CBS 実装で、MCMF low-level の固定参照には使わなかった。 |
| 今回のブラウザ実装       | Bellman–Ford の successive shortest augmenting path。                                           |
| 差異を選んだ理由         | 依存ゼロで Worker 上に置くため。                                                                |

## 今回の実装方針

`src/lib/flow/min-cost-max-flow.ts` の純粋なフローエンジンと、`src/solvers/tapf/team-flow.ts` の時空間アダプタを実装した。単一チームなら Solver として登録し、CBM ではチームごとの low-level として呼ぶ。

## 必要なテスト

最小費用の小グラフ、矩形 TAPF、CBM の TAPF プリセット、容量不足、決定性、残存衝突なし。

## 未対応機能

多 commodity の一般フロー、連続時間、論文の全 Pareto 目的、単独 MCMF で複数チームを同時に解くこと。
