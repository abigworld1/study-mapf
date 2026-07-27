# Push and Rotate

- algorithm-id: `push-and-rotate`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

connected undirected graph 上の pebble motion / one-shot MAPF。1 action は 1 agent を隣接する
空き vertex へ移す。各 connected component に空き vertex が 2 個以上ある class を対象とする。

## 原論文

- paper-id: `push-and-rotate-aamas-2013`
- 参照した節: §2、§3、§4、§4.1、§4.2、§4.3、Appendix
- 参照したページ: PDF pp.1–8
- 参照した Algorithm 番号: Algorithms 1–4（PDF pp.4–5）

会議論文 p.6 が完全な `push / swap / rotate / clear` 仕様として参照する著者補足資料
`Boris de Wilde, Cooperative Multi-Agent Path Planning, MSc thesis, TU Delft, 2012` の
Algorithms 4.1.1–4.1.4、4.2.1–4.2.11（thesis pp.29–49）も確認した。

## 状態表現

agent assignment、occupancy、完了集合 `F`、現在 agent が通った trail `q`、逐次 move 列。
前処理は iterative Tarjan で biconnected components を求め、空き vertex 数 `m` に対する距離
`m - 2` 以下の components を subproblem へ統合する。agent membership、subproblem priority relation、
priority propagation も明示的に保持する。

## 遷移

原論文の `plan` と同じく shortest path を進み、`push` が失敗すれば `swap`、trail が cycle になれば
`rotate` を使う。`swap` は `multipush / 4-stage clear / exchange / reverse` を transaction として行い、
最後に trail を逆走して finished agent を `resolve` する。

## 目的関数

対象 class で feasible な逐次 move 列を得ること。最短 move 数は目的にせず、論文 §6 は solution
quality 改善を future work とする。

## ヒューリスティック

各 planning agent の arbitrary shortest path、swap 候補の degree 3 以上 vertex、clear vertex から
空き vertex への shortest path。subproblem priority は isthmus で先に goal を塞ぐ関係から作る。

## 終了条件

subproblem priority 順に全 agent を goal へ送り、trail 上で goal から外れた finished agent の resolve が
完了したら成功。相反する priority relation は解なし、対象 class 外は unsupported、timeout / expansion /
move 上限は証明付き解なしと区別した構造化結果にする。

## 理論保証

| 項目       | 値       | 根拠（原文とページ）                                                       |
| ---------- | -------- | -------------------------------------------------------------------------- |
| 完全性     | 条件付き | PDF p.5 Theorem 1: 各 connected component に空き vertex が 2 個以上        |
| 最適性     | なし     | PDF p.6 §6 は solution quality 改善を future work とし、最短列を保証しない |
| 準最適保証 | なし     | PDF §5 の move 数は実験比較であり bound ではない                           |

### 保証が成立する条件

undirected graph、各 connected component に少なくとも 2 個の unoccupied vertices、Algorithms 1–4
の subproblem decomposition / priority と完全な primitives を使うこと。ブラウザ上限での打ち切りは除く。

## タイブレーク

同 priority agent は論文 Algorithm 4 p.5 で random selection。実装は `context.random()` から
一度だけ決定的 rank を作る。shortest path と candidate vertex の tie は vertex index 昇順。

## 論文中で未指定の箇所

- 同 priority agent の random distribution
- arbitrary shortest path の tie
- 会議版単独では省略された primitive の完全仕様（著者 thesis で補完）
- connected component ごとの実行結果を site の単一 TimedPath へ統合する方法
- Algorithm 4 の `q` は空列で初期化して移動先 `v` を append する表記だが、同頁の証明説明は
  swap で後退した finished agent の現在地が `q` 上にあることを要求する。実装は「通過 path」という
  本文の定義に合わせ、top-level plan の始点も `q` に含める

## 公開実装との差異

|                          | 方式                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 論文で定義された方式     | subproblem decomposition、priority、plan / push / swap / rotate / resolve                                                            |
| 公開実装で採用された方式 | `push-and-rotate-cbs-pp` commit `bba48f17` は第三者実装。LICENSE 不在のため read-only                                                |
| 今回のブラウザ実装       | Algorithms 1–4 と著者 thesis の decomposition / priority / plan / push / swap / rotate / resolve / 4-stage clear。4 近傍 grid に限定 |
| 差異を選んだ理由         | ライセンス不明コードを転記せず独立実装し、一般 graph import と smoothing を除いて browser の逐次 trace と安全上限へ適合させるため    |

公開 checkout は CMake configure には成功したが、現行 GCC では `node.h` の `size_t` に必要な
`<cstddef>` が無く build が失敗した。LICENSE 不在の read-only source は修正せず、output 比較は未完了。

## 今回の実装方針

move を常に単独 agent から空き隣接 cell への移動として検査し、swap / full-cycle rotate の準備操作は
snapshot 上で試して成功時だけ commit する。Tarjan は browser stack を溢れさせない iterative 実装、
同 priority の選択は seed 付き、connected component ごとの空き数は探索前に guard する。

## 必要なテスト

- 空き 2 個以上の swap 小規模例
- 空き 2 個未満と disconnected component 条件の guard
- `checkPaths()`、determinism、seed tie、abort / timeout / node limit
- 空き cycle / 満杯 cycle の rotate と全逐次 move の合法性
- isthmus で隔てた subproblem の分解・priority relation
- 空き 2 個だけの dense 二部屋 graph と、3×2 上の 36 configuration
- push / clear / swap / rotate / subproblem / priority trace
- ライセンス不明参照実装は output 比較だけ行い、コードを取り込まない

## 未対応機能

solution smoothing、一般 graph file import、論文 benchmark map 411 の再現、異なる connected component の
並列 schedule、非一様 edge cost。ブラウザ安全上限による打ち切り時には Theorem 1 を適用せず、
`timeout` / `node-limit` として返す。
