# PIBT（Priority Inheritance with Backtracking）

- algorithm-id: `pibt`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

原論文の中心は iterative MAPF だが、§4.4.1 は one-shot MAPF への適用として全 agent が同時に goal configuration に入るまで反復する。サイトの `Scenario` には goal 更新列がないため、ブラウザ版はこの one-shot wrapper のみを実装する。vertex collision と edge-swap collision を禁じ、following は許す。

## 原論文

- paper-id: `pibt-aij-2022`
- 参照した節: §4 Priority Inheritance with Backtracking、§4.3 Theoretical Analysis、§4.4.1 One-Shot MAPF
- 参照したページ: PDF pp.8–13
- 参照した Algorithm 番号: Algorithm 1（PDF p.9）

## 状態表現

時刻 `t` の configuration、agent ごとの goal、経過 priority integer `eta_i`、unique fractional tie-break `epsilon_i`、次 configuration の部分割当を持つ。各 goal から全 cell への true-distance table を前計算する。

## 遷移

各 timestep で priority 降順に未割当 agent を処理する。候補は隣接 cell と wait で、goal までの true distance が小さい順、同点なら現在空いている cell を先にする。候補が別 agent に占有され、その agent が未割当なら priority を継承して再帰する。vertex / edge-swap を避けられなければ候補を backtrack し、全候補失敗時は現在 cell を予約して wait する。

## 目的関数

最適化探索ではない。one-shot で最初に simultaneous goal configuration に到達した時刻までの path を返し、サイト共通の sum of costs / makespan を計算する。

## ヒューリスティック

各 agent の goal を root とする BFS true distance。Algorithm 1 line 13 の `dist(v, g_i)` に対応する。

## 終了条件

全 agent が同じ timestep に各 goal を占有したら solved。`options.horizon` または `maxHorizon`、timeout、node limit、AbortSignal で打ち切る。horizon 到達は PIBT の不完全性を含む実行上の失敗であり、MAPF instance の unsatisfiable 証明ではない。

## 理論保証

| 項目       | 値       | 根拠（原文とページ）                                                                                                                                       |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完全性     | 条件付き | PDF p.3 は PIBT が MAPF に対して incomplete と明記。PDF p.12 は Theorem 1 の graph condition 下で「goal に stay する必要がない変種」に complete と述べる。 |
| 最適性     | なし     | PDF p.3 は PIBT が MAPF に対して neither complete nor optimal と明記。                                                                                     |
| 準最適保証 | なし     | 解品質 bound は与えられていない。                                                                                                                          |

### 保証が成立する条件

PDF p.11 Theorem 1: 任意の隣接 2 vertex が長さ 3 以上の simple cycle に含まれる graph では、全 agent は collision-free に動き、各 agent は `diam(G)|A|` timestep 以内に一度 goal へ到達する。ただし PDF p.12 が明記する通り、これは全 agent の simultaneous goal configuration や stay-at-goal を保証しない。

## タイブレーク

priority は `p_i(t)=eta_i(t)+epsilon_i`、`epsilon_i` は agent ごとに unique。候補は true distance、次に current occupancy の有無。論文が残りの同点順を指定しないため、ブラウザ版は solver seed から `context.random()` で一度だけ agent ごとの unique `epsilon_i` と候補 tie-rank を生成し、その実行中は固定する。

## 論文中で未指定の箇所

- one-shot 実行の既定 timestep 上限。
- true distance と occupancy が同じ候補同士の順序。
- graph condition を満たさない場合の failure reason。
- browser 用 trace / expansion count の定義。

## 公開実装との差異

|                          | 方式                                                                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | `eta + epsilon` の動的 priority、distance と occupancy の候補順、再帰的 inheritance / backtracking。                                                                                                                                                                      |
| 公開実装で採用された方式 | `.references/pibt2` commit `faab5b9...` は elapsed の次に initial distance、乱数 tie-break を使う。`.references/pypibt` commit `a3c97f6...` は初期 priority に start-goal distance/grid size を使い、候補を seed 付き shuffle 後 distance sort する。双方 MIT、参照のみ。 |
| 今回のブラウザ実装       | AIJ 論文 Algorithm 1 の `eta + epsilon` を優先し、occupancy tie-break を明示。one-shot termination を実装。満杯 2×2 clockwise rotation で pypibt と success、makespan=1、configuration 列、path validity が一致した。                                                     |
| 差異を選んだ理由         | 原論文の priority 定義に忠実にしつつ、同一 seed の決定性と教材上の再現可能性を満たすため。                                                                                                                                                                                |

## 今回の実装方針

PIBT 1-step kernel と one-shot coordinator を分離する。`priority-order`、`candidate-evaluation`、`inherit-priority`、`backtrack`、`move` を発火する。PIBT の再帰呼出を expanded、候補評価を generated として計測する。`extra.maxTimesteps` は `1..maxHorizon` の範囲で受理する。

## 必要なテスト

- simple cycle graph の swap / rotation を solved とし `checkPaths()` で検証。
- corridor など graph condition 外で horizon failure を構造化して返す。
- inheritance / backtrack / priority / move event。
- `eta` の priority reset、unique deterministic tie-break。
- 同一 seed の決定性、異なる seed でも path validity、timeout、node limit、abort、rule guard。

## 未対応機能

- iterative goal updates、MAPD task allocation、PIBT+。
- graph の dodgeable / biconnected 条件の自動証明と、それに基づく保証 badge の切替。
- decentralized execution。

## 検証結果

- `tests/unit/batch3-solvers.test.ts`: 2×2 rotation、inheritance event、graph condition 外の horizon failure、決定性、各 limit。
- `tests/unit/invariants.test.ts`: 10 seed で solved result に `checkPaths()` を適用。
- `pypibt` commit `a3c97f6...` は環境の NumPy で固定 fixture を直接実行した。pytest 自体は環境に無いため repository test suite 全体は実行していない。
