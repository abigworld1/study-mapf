# MAPF-LNS（Anytime MAPF via Large Neighborhood Search）

- algorithm-id: `mapf-lns`
- 調査日: 2026-08-01
- 担当: Codex

## 対象問題

one-shot MAPF。原論文は vertex conflict と edge-swap conflict、stay-at-target、sum of individual path costs を採用する。サイト版は 4 近傍 grid、following conflict 許可、`goalBehavior: stay` に限定する。

## 原論文

- paper-id: `mapf-lns-ijcai-2021`
- 参照した節: §2、§4、§5.1–5.3、§6
- 参照したページ: pp.1–4
- 参照した Algorithm 番号: Algorithm 1（agent-based neighborhood）、Algorithm 2（map-based neighborhood）

## 状態表現

現在の collision-free plan `P` と、選択した agent 集合 `A_s`。固定 agent の path は動的障害物として予約し、近傍 agent の path だけを再計画する。agent-based の tabu list と ALNS の heuristic weights を保持する。

## 遷移

初期解を作り、近傍を destroy し、固定 path を避ける低レベル計画で repair する。新しい近傍の合計 cost が小さいときだけ incumbent と置換する。近傍は agent-based / map-based / random から選ぶ。

## 目的関数

論文の path length の sum（sum of costs）。サイトの `metrics.sumOfCosts` も到着時刻の和として計算する。近傍の受理判定は固定 path の寄与を含む全体 SOC で行う。

## ヒューリスティック

各 agent の delay（現在長 − start-goal の真距離）、交差点（degree ≥ 3）通過、ランダム選択。論文の ALNS は改善量を重みに反映する。

## 終了条件

初期解が得られなければ `no-solution`。得られた場合は timeout、node limit、abort、または反復上限まで改善を続け、incumbent を返す。有限打切りは最適性の証明ではない。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                                            |
| ---------- | ---- | ------------------------------------------------------------------------------- |
| 完全性     | 不明 | 原論文 p.1 は near-optimal algorithm と説明するが、完全性定理を主張していない。 |
| 最適性     | なし | 原論文 p.1 “with no guarantee” と明記。                                         |
| 準最適保証 | なし | 原論文 p.1 の no guarantee。                                                    |

### 保証が成立する条件

理論保証は確認できない。改善が続く anytime 性は探索上の性質であり、有限時間の最適性・完全性ではない。

## タイブレーク

論文は同値の詳細を指定しない。今回の実装は delay 降順、agent index、row-major cell index、seed 由来の決定的 rank を使う。

## 論文中で未指定の箇所

初期 solver の具体的な実装、低レベル探索の同値順、有限反復の停止方法はサイト API に合わせて明示する。

## 公開実装との差異

|                          | 方式                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | EECBS/PP 等で初期解を作り、3 種の destroy heuristic と repair operator を ALNS で組み合わせる。                      |
| 公開実装で採用された方式 | `Jiaoyang-Li/MAPF-LNS` は USC Research License。初期 EECBS/PP/PPS と C++ の SIPP/ECBS 系を用い、実験向け設定も含む。 |
| 今回のブラウザ実装       | 既存の deterministic prioritized planner を初期解・repair に使い、agent/map/random neighborhood を実装。             |
| 差異を選んだ理由         | ブラウザの依存・入力上限を守り、ライセンス不明／非標準コードを転記せず独立実装するため。                             |

### 参照実装のビルドと固定ケース

参照リポジトリは CMake で `/tmp` にビルドできた（Boost / Eigen を検出）。同梱 Moving AI の map と scen の先頭 2 agent を `-k 2 -t 1` で実行すると、公式版は `LNS(EECBS;PP)`、SOC 52、成功終了だった。ブラウザ版を同じ map/scen から組み立てた一時比較では、SOC 64、makespan 36、2 path を返した（`mapf-lns` は反復 budget 到達で timeout）。初期解を EECBS で作る公式版と Space-Time A* に統一したブラウザ版の差であり、経路の完全一致は要求していない。ブラウザ版の path validity と seed 決定性は `batch6-solvers.test.ts` で確認した。

## 今回の実装方針

論文の destroy / repair / accept-if-better の骨格を保つ。近傍内の計画は予約表付き Space-Time A* を優先順に呼び出し、失敗した近傍は破棄する。`context.random()` と seed rank で決定性を保つ。

## 必要なテスト

- 既知の collision-free 初期解から SOC が改善または維持されること
- solved の path validity と衝突 0
- 同じ seed の決定性
- 初期解失敗、timeout、node-limit、abort
- neighborhood / accept / reject / incumbent イベント

## 未対応機能

論文実装の EECBS、SIPP、restricted random walk の全細部、実時間ベースの ALNS weight decay は簡略化している。
