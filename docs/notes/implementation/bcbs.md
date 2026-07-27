# BCBS（Bounded CBS）

- algorithm-id: `bcbs`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

one-shot MAPF、sum of costs。サイト上の rule 対応範囲は CBS と同じ。

## 原論文

- paper-id: `bcbs-ecbs-socs-2014`
- 参照した節: “Bounded Suboptimal CBS”, “BCBS”
- 参照したページ: PDF pp.5–6
- 参照した Algorithm 番号: Algorithm 1 は basic CBS（PDF pp.3–4）。BCBS は PDF p.6 の focal-search 定義と Theorem 1 で規定

## 状態表現

CBS と同じ CT node と `(cell,time)` low-level node。高・低それぞれに OPEN と FOCAL の論理集合を持つ。

## 遷移

CBS と同じ standard split。低レベルは `f <= wL * fMin` の FOCAL、高レベルは `cost <= wH * minCost` の FOCAL から conflict 数最小を選ぶ。

## 目的関数

sum of costs。要求された全体係数 `w` を `wH * wL = w` に分解する。既定は `wH = wL = sqrt(w)`、`extra.highLevelWeight` と `extra.lowLevelWeight` で明示できる。

## ヒューリスティック

低レベル admissible `f=g+h` と CAT conflict 数 `hc`。高レベル admissible key は現 solution cost、secondary key は solution 内 conflict 数。

## 終了条件

選択 CT node が conflict-free なら solved。OPEN 空、timeout、node limit、AbortSignal、有限 horizon でも停止する。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                              |
| ---------- | ---- | ----------------------------------------------------------------- |
| 完全性     | あり | `bcbs-ecbs-socs-2014` PDF p.6 “Thus, BCBS and ECBS are complete.” |
| 最適性     | なし | bounded-suboptimal 版として定義                                   |
| 準最適保証 | あり | PDF p.6 Theorem 1: `BCBS(wH,wL)` の cost は高々 `wH*wL*C*`        |

### 保証が成立する条件

`wH,wL >= 1`、admissible low-level heuristic、両レベルが定義どおり FOCAL を選択すること。ブラウザ安全上限で打ち切った結果は対象外。

## タイブレーク

論文が secondary に `hc` を指定。完全同値は cost、生成順。低レベルは CAT conflict 数、f、g 降順、生成順。

## 論文中で未指定の箇所

利用者が全体 `w` だけを渡す場合の `wH,wL` の分配。論文の実験にある `sqrt(w)` 分配を既定にする。

## 公開実装との差異

|                          | 方式                                                                              |
| ------------------------ | --------------------------------------------------------------------------------- |
| 論文で定義された方式     | 高・低レベル双方の focal search。保証係数は積                                     |
| 公開実装で採用された方式 | 対応する独立 BCBS 公開実装はマニフェストに登録されていない                        |
| 今回のブラウザ実装       | CBS 共通基盤上で 2 係数を個別検証し、積を `suboptimalityBound` の保証値として扱う |
| 差異を選んだ理由         | 論文の分配比較を再現でき、UI の単一 `w` とも接続できるため                        |

## 今回の実装方針

CBS core の node selection と low-level weight だけを差し替え、分岐・constraint semantics は共通化する。

## 必要なテスト

- certified oracle に対して `cost <= w*C*`
- 明示した `wH*wL` と返却 bound の一致
- `wH<1` / `wL<1` の構造化エラー
- path 不変条件、決定性、trace

## 未対応機能

論文の GCBS、別の `hc`（pairs / vertex cover / alternating heuristic）、無限 horizon。
