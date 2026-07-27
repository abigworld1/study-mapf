# PBS（Priority-Based Search）

- algorithm-id: `pbs`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

one-shot MAPF。原論文とサイト既定はいずれも離散時間の graph 上で vertex collision と逆向き edge collision を禁じ、goal 到達後は target vertex に留まる。ブラウザ版は 4 近傍 grid、move / wait、sum of costs（論文の flowtime）を報告する。`forbidFollowing: true`、`allowDiagonal: true`、`goalBehavior: disappear` は原論文のモデル外なので受理しない。

## 原論文

- paper-id: `pbs-aaai-2019`
- 参照した節: Prioritized Planning / Priority-Based Search / Function UpdatePlan / Low-Level Search / Properties
- 参照したページ: PDF pp.2–5
- 参照した Algorithm 番号: Algorithm 2（PDF p.5）

## 状態表現

高レベルの priority-tree（PT）node は、agent 間の strict partial order を表す DAG、全 agent の current path、sum of costs、生成順を持つ。DAG の辺 `higher -> lower` は `higher ≺ lower` を表す。低レベル state は `(cell, time)` である。

## 遷移

current plan の最初の vertex / edge-swap collision に含まれる 2 agent について、片方を higher priority とする 2 子を生成する。逆向きの到達可能性が既にある子は cycle になるため生成しない。新しく lower になった agent と、その下位 closure を topological order で調べ、higher paths と衝突する agent だけを再計画する。

## 目的関数

PBS の high level は depth-first search で、最適化保証はない。子 node は論文 Algorithm 2 line 23 に従い cost の非増加順で STACK に入れ、次に小さい cost の子を展開する。表示する `sumOfCosts` は各 path の goal 到達時刻の和、`makespan` は最大到達時刻である。

## ヒューリスティック

各 goal からの障害物込み true distance を admissible heuristic とする space-time A*。higher-priority paths を hard reservation とする。同じ `(cell,time)` への同長 path は、まず incomparable agents との collision 数、次に lower-priority agents との collision 数、最後に生成順で tie-break する。

## 終了条件

STACK から取り出した plan に collision が無ければ solved。STACK が空なら no-solution。`timeoutMs`、`maxExpansions`、`maxHorizon`、`AbortSignal` でも停止する。有限 horizon 到達は非存在証明ではないため、warning を付けた `no-solution / search-exhausted` とする。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                                                                                                             |
| ---------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 完全性     | 不明 | PDF p.5 は PT depth が `O(M^2)` と述べるが、PBS の完全性定理は確認できない。prioritized planning 一般は PDF p.2 Theorem 1 で不完全。             |
| 最適性     | なし | PDF p.7 の「never more than 4% worse」は実験観測であり保証ではない。論文は PBS を near-optimal と経験的に記述し、optimality theorem を与えない。 |
| 準最適保証 | なし | PDF p.7 の 4% は実験集合上の観測で、任意 instance に対する bound ではない。                                                                      |

### 保証が成立する条件

PBS 自身について complete / bounded-suboptimal を保証する条件は原論文から確認できなかった。固定 total order の prioritized planning については well-formed MAPF instance なら complete（PDF p.3 Theorem 3）だが、これは PBS 全体の保証として転用しない。

## タイブレーク

論文は high level で最初の collision を選び、2 子のうち cost の小さい子を先に展開する。low level は同じ最短長の中で incomparable paths との collision 数、次に lower-priority paths との collision 数を最小化する。残る同点は未指定なので、ブラウザ版は cell の row-major 順と生成順を使う。

## 論文中で未指定の箇所

- `maxHorizon` 到達時の扱い。
- 完全に同点の child の順序。
- 完全に同点の low-level state の順序。
- browser の timeout / node-limit / trace 間引き。

## 公開実装との差異

|                          | 方式                                                                                                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | Algorithm 2 の DFS、partial-order 分岐、UpdatePlan、incomparable/lower の 2 段 CAT tie-break。                                                                                                                                                                       |
| 公開実装で採用された方式 | `.references/pbs` commit `d7b91fa5...` は author-maintained C++。衝突集合を保持し、影響する lower agent を優先 queue へ追加する最適化、SIPP / Space-Time A* の切替、複数 conflict selection rule を持つ。USC 独自ライセンスのため参照のみ。`/tmp` build は成功した。 |
| 今回のブラウザ実装       | 論文 Algorithm 2 を直接構成し、closure を topological order で検査する。low level は TypeScript の独立実装。3×2 swap fixture で公開実装と success、SOC=6、makespan=4、path validity が一致した。                                                                     |
| 差異を選んだ理由         | 教材上 Algorithm 2 との対応を明瞭にし、ライセンス不適合コードを転記せず、既存 Solver API と共通 limit / event に適合させるため。                                                                                                                                     |

## 今回の実装方針

priority DAG、PBS 専用 2 段 CAT space-time A*、PT DFS を `src/solvers/pbs/` に分離する。`set-priority`、`update-priority-dag`、`replan-lower-priority-agent`、`detect-conflict`、`expand-node` を発火する。initial partial order は `extra.initialPriority` の `{higher, lower}` 配列で任意指定でき、cycle と未知 ID を構造化 error にする。

## 必要なテスト

- swap + detour の solved path を `checkPaths()` で検証。
- 固定 Prioritized Planning が失敗する小例を PBS が順序分岐で解く。
- initial partial order の cycle / unknown agent を拒否。
- priority DAG / replan / conflict event。
- 同一 seed の決定性、timeout、node limit、AbortSignal、trace limit、未対応 rule。

## 未対応機能

- author implementation の conflict selection variants と SIPP low level。
- browser horizon を越えた無限時空間の非存在証明。
- 公開実装との benchmark 全件比較。

## 検証結果

- `tests/unit/batch3-solvers.test.ts`: registry、3×2 公開実装比較、PT event、initial DAG validation、既知の不完全例、各 limit。
- `tests/unit/invariants.test.ts`: 10 seed で solved result に `checkPaths()` を適用。
- `.references/pbs` は `/tmp/study-mapf-pbs-build` へ build し、Space-Time A\* mode の固定 fixture と比較した。完全に同じ path は要求していない。
