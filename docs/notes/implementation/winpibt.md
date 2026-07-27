# winPIBT（windowed PIBT）

- algorithm-id: `winpibt`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

原論文は iterative MAPF を主対象とし、§5.1 で classical MAPF も評価する。サイトに goal 更新 API がないため、ブラウザ版は固定 goal の one-shot termination（全 agent が同時に goal）を実装する。原論文の centralized form、4 近傍、vertex / edge-swap 禁止、following 許可を使う。

## 原論文

- paper-id: `winpibt-2019`
- 参照した節: §3.2 Disentangled、§4 Windowed PIBT、§4.2 Algorithm、§4.2.1 Prioritization、§4.2.2 Iterative Use、§5.1 Classical MAPF
- 参照したページ: PDF pp.3–7
- 参照した Algorithm 番号: Algorithm 1（PDF p.5）、Algorithm 2（PDF p.6）

## 状態表現

agent ごとの確定 path `pi_i` と last secured time `ell_i`、ideal provisional path `Pi_i`、動的 priority `eta_i + epsilon_i`、priority inheritance 中の request set `R`、fixed finite window `w` を持つ。path 長が異なる間も pairwise isolated である path 集合を論文の `disentangled` として扱う。

## 遷移

Algorithm 2 に従い各 timestep で priority 順に、path が current time までしか確定していない agent を延長する。highest-priority agent は `t+w` まで、lower agent はそれ以前の higher paths の最短末尾 `kappa` までしか確定しない。Algorithm 1 は constrained A* で `beta=max(alpha,max ell)` まで ideal path を求め、`alpha` まで provisional に登録し、1 node ずつ確定する。要求 cell が短い別 path の末尾なら、その agent を 1 step 延長する retroactive priority inheritance を行う。同時刻の末尾占有では PIBT と同じ再帰 / backtrack を行い、失敗時は suffix を取り消して ideal path を再計算する。

## 目的関数

最適化保証はない。constrained A* は各呼出しで shortest ideal path を求めるが、fixed window と priority restriction を含む全体の SOC / makespan は最適ではない。サイトは最初の simultaneous goal configuration までを返す。

## ヒューリスティック

goal からの障害物込み true distance。paper §5 は constraints を満たす shortest path に A* を使用したと明記する（PDF p.7）。

## 終了条件

全 agent が同時に goal に達すれば solved。`extra.windowSize` は有限正整数、`extra.maxTimesteps` / `options.horizon` は `maxHorizon` 以下。horizon、timeout、node limit、AbortSignal で停止する。paper §5.1.2 と同じく timestep 上限での失敗は deadlock / livelock を含み、unsatisfiable の証明ではない。

## 理論保証

| 項目       | 値       | 根拠（原文とページ）                                                                                                                                                                      |
| ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完全性     | 条件付き | PDF p.7 Theorem 4.3 は dodgeable graph かつ各 window が常に有限なら全 agent が有限時間で各 destination に到達すると保証する。ただし simultaneous one-shot goal の完全性とは述べていない。 |
| 最適性     | 不明     | 原論文から一般的 optimality / non-optimality の明示的定理を確認できない。実験で CBS / ECBS と cost 比較することは保証ではない。                                                           |
| 準最適保証 | なし     | 任意 instance に対する cost bound は示されていない。                                                                                                                                      |

### 保証が成立する条件

graph が dodgeable、すなわち各 adjacent vertex pair を含む長さ 3 以上の simple cycle が存在し、全 agent の window が毎 timestep 有限であること。Theorem 4.3 は individual reachability であり、goal occupancy の同時成立や stay-at-goal classical MAPF の completeness と混同しない。

## タイブレーク

priority scheme は PIBT と同じ `eta+epsilon`。ideal path の A* tie-break は論文未指定なので `f`、大きい `g`、row-major cell、生成順とする。`epsilon` と完全同点候補 rank は `context.random()` から一度生成して固定する。

## 論文中で未指定の箇所

- `validPath` / `registerPath` 内 A* の完全な tie-break。
- classical MAPF の既定 timestep 上限（実験は 1000）。
- same-priority / same-A* key の順序。
- browser limit に当たったときの result mapping。

## 公開実装との差異

|                          | 方式                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 論文で定義された方式     | Algorithms 1–2、provisional paths、disentangled constraint、retroactive inheritance、fixed finite window。                                                                                                                                 |
| 公開実装で採用された方式 | paper は `Kei18/pibt` を案内するが、manifest 登録済み `.references/pibt2` commit `faab5b9...` には現時点で winPIBT source が見当たらない。CMake は `grid-pathfinding` / GoogleTest submodule 欠落で失敗し、build / output 比較はできない。 |
| 今回のブラウザ実装       | Algorithms 1–2 の centralized form を TypeScript で独立実装し、`validPath` は time-expanded A*、window は全 agent 共通の定数 option とする。                                                                                               |
| 差異を選んだ理由         | 手元の一次資料で検証できる pseudocode を根拠にし、取得できない実装の挙動を推測・転記しないため。                                                                                                                                           |

## 今回の実装方針

PIBT と priority / distance table / validation を共有するが、winPIBT の provisional reservation と suffix revoke は独立 module にする。window=1 は PIBT と同じ 1-step semantics になることを回帰テストする。event は `priority-order`、`candidate-evaluation`（A* candidate）、`inherit-priority`、`backtrack`、`reserve`、`replan`、`move` を使う。

## 必要なテスト

- window=1 と PIBT が同一 seed / scenario で同じ path または少なくとも同じ有効な 1-step semantics を持つ。
- window>1 で複数 timestep の reserve / replan event を出し、`checkPaths()` を通る。
- path 長が異なる provisional plan でも disentangled invariant を破らない。
- window / timestep option validation。
- horizon、timeout、node limit、abort、trace limit、未対応 rule、決定性。

## 未対応機能

- task allocation と goal 更新を伴う iterative / MAPD wrapper。
- agent ごと・時刻ごとに変化する adaptive window。
- decentralized 2w-hop communication。
- 未取得の公開 winPIBT 実装との数値比較。

## 検証結果

- `tests/unit/batch3-solvers.test.ts`: window=1 と PIBT の path 一致、window>1 の provisional reservation、option、決定性、各 limit。
- `tests/unit/invariants.test.ts`: 10 seed で solved result に `checkPaths()` を適用。
- public winPIBT source が登録 checkout に無いため `reference-validated` にはしていない。
