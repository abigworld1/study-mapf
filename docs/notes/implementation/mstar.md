# M*（Subdimensional Expansion）

- algorithm-id: `mstar`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

one-shot MAPF。原論文は各 robot の configuration graph の tensor product 上で定義する。
サイト版は 4 近傍 grid、move / wait、vertex conflict と edge-swap conflict 禁止、following 許可、
stay at goal に限定する。edge 上の collision は原論文が述べる「中間 vertex へ変換」と等価な
transition 検査として扱う。

## 原論文

- paper-id: `mstar-aij-2015`
- 参照した節: §3、§4、§4.1、§4.2、§4.3、§4.3.1、§4.4、§5、§5.1
- 参照したページ: PDF pp.7–10、16–31
- 参照した Algorithm 番号: Algorithm 1（PDF p.21）、Algorithm 2（PDF p.22）

## 状態表現

joint configuration を key にする A* node。各 node は `g`、SIC heuristic、best parent、
collision set、backpropagation set を持つ。collision set は、その node から探索済みの経路を
通って到達した collision に関与する agent の集合で、探索中に単調に増える。

## 遷移

collision set に含まれる agent は move / wait の全候補を使う。含まれない agent は
individual policy が選ぶ shortest-path successor だけを使う。生成した configuration が衝突する
場合は解候補にせず、衝突 agent を predecessor とその backpropagation ancestors へ伝播する。

## 目的関数

sum of individual path costs。goal で待機し続ける edge は 0 cost、それ以外の各 agent の
move / wait は 1 cost として、サイトの sum of costs と一致させる。

## ヒューリスティック

各 agent の goal からの shortest-path distance の和（SIC）。原論文式 (2)、PDF p.20。
individual policy は同じ distance を 1 減らす successor を決定的に 1 つ選ぶ。

## 終了条件

A* が joint goal configuration を pop したら parent を復元する。OPEN が空なら no-solution。
timeout、abort、`maxExpansions`、`maxHorizon` では打ち切る。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                           |
| ---------- | ---- | -------------------------------------------------------------- |
| 完全性     | あり | PDF p.30 Theorem 1: M* is complete and optimal                 |
| 最適性     | 最適 | PDF p.30 Theorem 1                                             |
| 準最適保証 | なし | basic M* は optimal。inflated M* は別 variant として §5 に分離 |

### 保証が成立する条件

有限 graph、正の action cost、admissible heuristic、collision set の完全な backpropagation。
ブラウザ版の安全上限で打ち切った実行は theorem の対象外。

## タイブレーク

原論文は A* の同一 `f` tie と individual policy が複数ある場合の選択を指定しない。
ブラウザ版は `f`、`h`、生成順、configuration key の順とし、policy は cell index 最小を選ぶ。

## 論文中で未指定の箇所

- A* OPEN の同値 tie
- 複数の individually optimal successor から選ぶ policy
- edge collision を実 graph へ展開する具体的なデータ構造
- ブラウザ向けの horizon / expansion limit

## 公開実装との差異

|                          | 方式                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | basic M*、collision set と backpropagation set、limited neighbors                                                                                   |
| 公開実装で採用された方式 | 登録済み `libmultirobotplanning` commit `4c75fa20` には M* source がなく、`public-cppmomapf` は multi-objective MOM* で basic M* の比較対象ではない |
| 今回のブラウザ実装       | Algorithm 1–2 の basic M*。edge-swap を transition collision として直接検出                                                                         |
| 差異を選んだ理由         | サイトの既定 conflict model を黙って弱めず、basic M* 以外との照合を主張しないため                                                                   |

## 今回の実装方針

逆向き BFS で distance / policy を作り、collision set の version が増えた node を OPEN へ戻す。
backpropagation は work stack で反復実装し、再帰深さに依存させない。joint successor の直積生成中に
vertex conflict を早期検出し、edge-swap は完成 configuration で検出する。

## 必要なテスト

- `checkPaths()` と SOC oracle による最適性比較
- 衝突なしでは policy path だけ、衝突例では collision set が増えること
- backpropagation / re-expansion trace
- determinism、abort、timeout、node / horizon limit、rule guard

## 未対応機能

Recursive M*、Operator Decomposition M*、EPEM*、inflated M*、Meta-Agent policy optimization、
continuous configuration graph、非一様 edge cost。
