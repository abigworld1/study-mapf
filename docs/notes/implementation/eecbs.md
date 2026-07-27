# EECBS（Explicit Estimation CBS）

- algorithm-id: `eecbs`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

one-shot MAPF。原論文 §2.1 と同じく vertex / swapping conflict、stay at target、sum of costs。サイトでは 4 近傍 grid に限定する。

## 原論文

- paper-id: `eecbs-aaai-2021`
- 参照した節: §§2.1–2.3, §§3.1–3.4, §4.1–4.4
- 参照したページ: PDF pp.2–7
- 参照した Algorithm 番号: Algorithm 1（PDF p.6）。基礎 EECBS では同ページの説明どおり lines 2, 8, 13, 19–22 の後発 improvement を除く

## 状態表現

CT node は constraints、bounded-suboptimal paths、cost、low-level 下界 `lb`、conflict 数 `hc` を持つ。高レベルに CLEANUP（lb）、OPEN（推定 `fHat`）、FOCAL（推定 `fHat` の範囲内を `hc` で選択）の 3 つの論理集合を置く。

## 遷移

ECBS と同じ bounded low-level focal search と standard split。高レベルは EES の SELECTNODE 3 条件で FOCAL / OPEN / CLEANUP のいずれかから node を選ぶ。

## 目的関数

sum of costs。`SolverOptions.suboptimalityFactor = w`。

## ヒューリスティック

admissible `lb(N)` は low-level `fMin` の和。distance-to-go は `hc(N)`。展開した親と best child から one-step distance error と cost error の global running averageを更新し、`hHat(N) = hc(N)/(1-meanDistanceError) * meanCostError`、`fHat=cost+hHat` とする。

## 終了条件

SELECTNODE で選んだ conflict-free CT node を返す。選択条件から `cost <= w*lb(bestLb)` が保たれる。その他は共通安全停止。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                                                                      |
| ---------- | ---- | --------------------------------------------------------------------------------------------------------- |
| 完全性     | 不明 | EECBS 固有の明示的な完全性定理・記述を確認できないため推測しない                                          |
| 最適性     | なし | bounded-suboptimal variant として定義（PDF p.1）                                                          |
| 準最適保証 | あり | PDF p.5 式 (2) と直後: EECBS は `cost(N) <= w*lb(bestLb)` の node だけを選び bounded suboptimality を保証 |

### 保証が成立する条件

`w>=1`、admissible low-level lower bound、SELECTNODE の 3 条件、bounded low-level path。ブラウザ安全上限による打切りは対象外。

## タイブレーク

CLEANUP は lb、OPEN は fHat、FOCAL は hc。論文に無い完全同値は cost、生成順。best child は fHat、次に hc、生成順。

## 論文中で未指定の箇所

online error の分母が 0 以下になる有限標本時の扱い。今回は `hHat=Infinity` として OPEN/FOCAL で後回しにし、CLEANUP による進行を保つ。

## 公開実装との差異

|                          | 方式                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | EES 3-list + online learned hHat + bounded low level。§4 で BP/PC/symmetry/WDG を段階追加                        |
| 公開実装で採用された方式 | `eecbs` commit `06ec7058...` は 3 heap と全改善を持つが USC の教育・研究・非営利限定ライセンスのため閲覧のみ     |
| 今回のブラウザ実装       | §3 の基礎 EECBS。3 list は active node 集合に対する決定的選択として実装し、§4 の改善は除外                       |
| 差異を選んだ理由         | Algorithm 1 が明示する基礎 EECBS の本質と bound を保ちつつ、重い WDG / symmetry machinery を別段階に分離するため |

公開実装のコードは転記していない。

## 今回の実装方針

ECBS low level を共有し、高レベル selection と online error model を EECBS 専用にする。各 node の fHat は現在の global average から再評価する。

## 必要なテスト

- certified oracle に対する `cost <= w*C*`
- EES の selection source と lower bound
- deterministic online error update
- path 不変条件、trace、安全停止

## 未対応機能

§4 の relaxed bypass、PC、rectangle/corridor/target symmetry reasoning、adaptive WDG、EECBS+。
