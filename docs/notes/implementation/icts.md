# ICTS（Increasing Cost Tree Search）

- algorithm-id: `icts`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

one-shot MAPF。原論文とサイト既定はいずれも 4 近傍グラフ、離散時間、move / wait、
vertex conflict と opposite-direction edge conflict を禁止し、following を許可する。
目的関数は sum of costs（各 agent が goal に到達するまでの move / wait 数の和）。

## 原論文

- paper-id: `icts-ijcai-2011`
- 参照した節: §2、§4、§5、§5.1、§5.2、§6、§8、§8.1
- 参照したページ: PDF pp.1–6
- 参照した Algorithm 番号: Algorithm 1（PDF p.4）

## 状態表現

高レベルの Increasing Cost Tree（ICT）ノードは agent ごとの厳密な個別コスト vector
`[C1, ..., Ck]`。低レベルでは各 agent の `MDD_i^Ci` を作り、同じ時刻層にある位置の
直積 configuration を状態にする。短い MDD は sink の goal node を dummy node で延長する。

## 遷移

ICT の子は cost vector のちょうど 1 成分を 1 増やす。MDD は start から goal へ厳密に
`Ci` step で到達できる cell だけを各層に残す。低レベルは各 MDD の edge の直積を列挙し、
vertex conflict と edge-swap conflict を含む組を捨てる。

## 目的関数

sum of costs。ICT の同じ深さにある node は root の SIC（Sum of Individual Costs）へ
同じ追加コストを足した値を持つ。

## ヒューリスティック

root の各成分は他 agent を無視した shortest-path distance。MDD の枝刈りにも goal からの
true distance を使う。低レベルは実現可能性判定であり、追加の評価関数は使わない。

## 終了条件

ICT を breadth-first に調べ、k-agent MDD の sink configuration へ到達した最初の node を返す。
ブラウザ版では `maxHorizon`、`maxExpansions`、timeout に達した場合は保証付きの no-solution
とはせず、対応する打ち切り結果と警告を返す。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                                                                                 |
| ---------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| 完全性     | 不明 | IJCAI 版は「optimal solutions」を主張するが、unsolvable instance に対する有限停止を明示した定理は PDF で確認できない |
| 最適性     | 最適 | PDF p.1 Abstract と p.2 §4。ICT の breadth-first search が最初の feasible cost vector を返す                         |
| 準最適保証 | なし | bounded-suboptimal variant は定義されない                                                                            |

### 保証が成立する条件

原論文 §2 の conflict と sum-of-costs 定義、および低レベルの完全な MDD 直積探索を使うこと。
ブラウザ安全弁による有限 horizon / node limit / timeout で打ち切った実行は最適性主張の対象外。

## タイブレーク

論文は同一 ICT level 内の順序と低レベル DFS の successor 順を指定しない。ブラウザ版は
agent の入力順、wait を含む successor の cell index 昇順を用いる。seed は結果を変えない。

## 論文中で未指定の箇所

- ICT の同一 depth 内の node 順序
- MDD 直積探索の successor 順序
- 安全上限に達したときの API outcome
- MDD cache の寿命と duplicate key の表現

## 公開実装との差異

|                          | 方式                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | ICT の BFS、agent ごとの MDD、k-agent MDD search。pairwise pruning は optional                 |
| 公開実装で採用された方式 | `hog2` commit `af9d42d0` を検索したが、この checkout に ICTS 実装は見つからなかった            |
| 今回のブラウザ実装       | Algorithm 1 の基本 ICTS と optional pairwise feasibility pruning。MDD は ICT node ごとに再構築 |
| 差異を選んだ理由         | 原論文だけで独立に検証可能な核へ限定し、存在しない参照コードとの一致を主張しないため           |

## 今回の実装方針

MDD の各層を walkable cell index の配列で保持し、低レベルは depth-first search と
transposition set で実現可能性を判定する。最初の feasible ICT node では joint configuration
列を TimedPath へ復元する。pairwise pruning は解を除外しない必要条件検査として使う。

## 必要なテスト

- `checkPaths()` による成功解の不変条件
- `jointStateOptimalSumOfCosts()` と小規模 instance の SOC を比較
- root node で解ける非衝突例と追加 cost が必要な swap / detour 例
- MDD / ICT / pairwise trace event
- determinism、abort、timeout、node limit、horizon limit、unsupported rules

## 未対応機能

Independence Detection との統合、MDD の差分再利用、pairwise pruning 後の MDD sparsification、
AIJ 2013 拡張版固有の改良、大規模 instance 向け bitset / CSP low level。
