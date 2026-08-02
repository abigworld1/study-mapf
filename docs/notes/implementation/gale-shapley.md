# Gale-Shapley 法（Deferred Acceptance）

- algorithm-id: `gale-shapley`
- 調査日: 2026-08-01
- 担当: Codex

## 対象問題

安定結婚／安定マッチング。MAPF Solver ではなく、割当の教育用内部ライブラリ。

## 原論文

- paper-id: `gale-shapley-1962`
- 参照した節: §3 Stable assignments and a marriage problem、§5 Optimality
- 参照したページ: PDF pp.5–7
- 参照した Algorithm 番号: deferred acceptance の反復手順

ページ番号は誌面の通しページではなく、確認に使用した PDF の物理ページ番号で統一する。

## 状態表現

proposer の次の候補、receiver の現在保持 proposer、双方の preference order。

## 遷移

未マッチ proposer が次の receiver へ申し込み、receiver は好みの高い方を保持する。

## 目的関数

費用最小化ではなく、blocking pair が存在しない安定性。proposer 提案なら proposer-optimal stable matching。

## ヒューリスティック

なし。receiver preference の順位表を O(1) 参照する。

## 終了条件

全 proposer が申し込みを終えたとき。

## 理論保証

| 項目       | 値       | 根拠（原文とページ）                                                                    |
| ---------- | -------- | --------------------------------------------------------------------------------------- |
| 完全性     | あり     | p.5 Theorem 1「There always exists a stable set of marriages.」                         |
| 最適性     | 条件付き | p.7 Theorem 2。提案側にとって、他の安定割当より悪くない。これはコスト最小とは別の意味。 |
| 準最適保証 | なし     | —                                                                                       |

### 保証が成立する条件

完全な preference list と strict order。欠落相手は本実装では未許容として unmatched 扱いにする。

## タイブレーク

原論文は preference が同順位になるケースを扱わない。入力順を順位として固定する。

## 公開実装との差異

|                          | 方式                                                  |
| ------------------------ | ----------------------------------------------------- |
| 論文で定義された方式     | deferred acceptance。                                 |
| 公開実装で採用された方式 | Batch 7 の参照実装は使用せず、原論文を直接実装した。  |
| 今回のブラウザ実装       | 決定的な proposer-oriented deferred acceptance。      |
| 差異を選んだ理由         | UI と MAPF の衝突ルールから独立した純関数にするため。 |

## 今回の実装方針

`src/lib/assignment/gale-shapley.ts` に実装し、blocking pair の検証関数も公開する。単体 Solver/registry には登録せず ImplementationStatus は `library`。

## 必要なテスト

安定性、proposer-optimal 性、未マッチ、決定性、Hungarian のコスト目的との違い。

## 未対応機能

同順位 preference の tie-breaking 以外の市場設計、容量付き college、シミュレータ実行。
