# ICBS（Improved Conflict-Based Search）

- algorithm-id: `icbs`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

one-shot MAPF、sum of costs。4 近傍、vertex / edge-swap conflict、stay at goal。

## 原論文

- paper-id: `icbs-ijcai-2015`
- 参照した節: Introduction, Algorithm 1, “Meta-agent merging improvements”, “Bypassing conflicts”, “Prioritize Conflicts”
- 参照したページ: PDF pp.1–5
- 参照した Algorithm 番号: Algorithm 1（PDF p.2）

## 状態表現

CBS の CT node に全 conflict 列を保持し、選択候補を cardinal / semi-cardinal / non-cardinal に分類する。

## 遷移

各 conflict から生成される 2 child の最短 path cost を調べ、両方増加なら cardinal、片方だけなら semi-cardinal、どちらも増加しなければ non-cardinal。cardinal を最優先、次に semi-cardinal。cardinal 以外では同 cost かつ conflict 数を減らす child path を helpful bypass として親へ採用し、constraint を CT に追加せず再判定する。

## 目的関数

sum of costs。最適性を保つ。

## ヒューリスティック

CBS と同じ admissible low-level heuristic。conflict classification は論文の等価な child-cost 定義を直接使う。

## 終了条件

conflict-free CT node を返す。その他は CBS と同じ安全停止。

## 理論保証

| 項目       | 値       | 根拠（原文とページ）                                                                                                                                        |
| ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完全性     | 条件付き | ICBS は CBS の最適探索を保つ改善として構成されるが、論文に ICBS 固有の完全性定理は無い。CBS の「解が存在すれば返す」と low-level solver の完全性に依存      |
| 最適性     | 最適     | `icbs-ijcai-2015` PDF p.1 は対象を optimal MAPF と明記し、ICBS を (MA)CBS+BP に MR/PC を統合した版として定義。PDF pp.4–5 の bypass は same-cost path に限定 |
| 準最適保証 | なし     | bounded-suboptimal 手法ではない                                                                                                                             |

### 保証が成立する条件

low level が最短 path、helpful bypass が同 cost、standard split が両分岐を保持すること。完全な論文版 ICBS の MR は complete/optimal な coupled MAPF low level を必要とする。

## タイブレーク

分類は cardinal、semi-cardinal、non-cardinal。各分類内は earliest conflict、agent 配列順。bypass は最初に生成した helpful child。

## 論文中で未指定の箇所

同分類 conflict の順と、同時に 2 つの helpful bypass がある場合の選択。上記の決定的規則を採用する。

## 公開実装との差異

|                          | 方式                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | ICBS(25) は MA-CBS(25)+BP+PC+MR。individual agent の分類は MDD、meta-agent は child cost を観察                                                                 |
| 公開実装で採用された方式 | `mapf-icbs` commit `a1357b...` はライセンス無しで閲覧のみ。一部 incomplete module と乱択 disjoint splitting を含む。`cbsh2-rtc` は USC 独自ライセンスで閲覧のみ |
| 今回のブラウザ実装       | CBS+PC+BP。MDD の代わりに定義と等価な 2 child の最短 cost を直接評価。MA-CBS merge と MR は未実装                                                               |
| 差異を選んだ理由         | coupled low-level と merge policy を別手法 MA-CBS として実装していない現状で、PC/BP の意味と最適性を変えず独立実装するため                                      |

公開実装のコードは転記していない。

## 今回の実装方針

metadata は `partial` とし、動く範囲を ICBS の PC+BP subset と明記する。classification の probe も全体の展開予算、timeout、trace に含める。

## 必要なテスト

- certified oracle と SOC 一致
- cardinal / semi / non の event
- helpful bypass event と同 cost
- path 不変条件、決定性、安全停止

## 未対応機能

MA-CBS、merge threshold B、merge-and-restart、MDD cache、meta-agent MDD、symmetry reasoning。
