# IMPLEMENTATION_STATUS.md

アルゴリズムごとの実装状況。**バッチを終えるたびに更新すること。**

最終更新: 2026-08-03（Codex / Batch 9 レビュー修正）

---

## 見方

2 つの軸を分けて記録する。混同しない。

| 軸                    | 値                    | 意味                                       |
| --------------------- | --------------------- | ------------------------------------------ |
| **実装状態** `status` | `runnable`            | シミュレータで動く                         |
|                       | `partial`             | 動くが原論文の一部のみ                     |
|                       | `library`             | 内部実装あり。単体 Solver では実行しない   |
|                       | `explanation-only`    | コードによる再現実装はない。解説と出典だけ |
|                       | `planned`             | 骨格だけ                                   |
| **再現度** `fidelity` | `educational`         | 原理を学ぶための簡略実装                   |
|                       | `paper-faithful`      | 原論文の主要処理を実装した                 |
|                       | `reference-validated` | 公開実装または既知結果と照合済み           |
|                       | `explanation-only`    | 実行可能な再現実装なし                     |

**一部だけ実装した状態を `reference-validated` にしない。**
照合したのが「何を」なのかを `validatedAgainst` と `implementationNote` に書く。

解説ページの正確性は別軸（`draft` / `reviewed` / `verified`）。MDX の frontmatter で管理する。

---

## 実装済み（registry に登録されている）

| algorithm-id           | 手法             | status   | fidelity            | 備考                                                                                                                                                              |
| ---------------------- | ---------------- | -------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bfs`                  | 幅優先探索       | runnable | educational         | 各エージェント独立。衝突は解消しない                                                                                                                              |
| `astar`                | A*               | runnable | educational         | 同上。ヒューリスティクスの効果を見るため                                                                                                                          |
| `space-time-astar`     | 時空間 A*        | runnable | paper-faithful      | 単一 agent の `(cell,time)` 探索。[ノート](docs/notes/implementation/space-time-astar.md)                                                                         |
| `sipp`                 | SIPP             | runnable | paper-faithful      | safe interval 探索。MAPF wrapper は固定順。[ノート](docs/notes/implementation/sipp.md)                                                                            |
| `prioritized-planning` | 優先順位付き計画 | runnable | paper-faithful      | 固定全順序。PBS の順序探索は含まない。[ノート](docs/notes/implementation/prioritized-planning.md)                                                                 |
| `cooperative-astar`    | Cooperative A*   | runnable | paper-faithful      | Manhattan + reservation table。[ノート](docs/notes/implementation/cooperative-astar.md)                                                                           |
| `hca-star`             | HCA*             | runnable | paper-faithful      | Algorithm 1 の on-demand RRA*。[ノート](docs/notes/implementation/hca-star.md)                                                                                    |
| `whca-star`            | WHCA*            | runnable | paper-faithful      | terminal edge、rolling window、RRA* 再利用。[ノート](docs/notes/implementation/whca-star.md)                                                                      |
| `cbs`                  | CBS              | runnable | paper-faithful      | standard split、SOC best-first、CAT。[ノート](docs/notes/implementation/cbs.md)                                                                                   |
| `bcbs`                 | BCBS             | runnable | paper-faithful      | high / low focal、保証係数 `wH*wL`。[ノート](docs/notes/implementation/bcbs.md)                                                                                   |
| `ecbs`                 | ECBS             | runnable | paper-faithful      | low-level `fMin` の和を CT lower bound に使用。[ノート](docs/notes/implementation/ecbs.md)                                                                        |
| `icbs`                 | ICBS (PC+BP)     | partial  | paper-faithful      | PC と helpful BP。MA-CBS / MR は未対応。[ノート](docs/notes/implementation/icbs.md)                                                                               |
| `eecbs`                | EECBS            | runnable | paper-faithful      | §3 の EES 3-list と online error。§4 改善は未対応。[ノート](docs/notes/implementation/eecbs.md)                                                                   |
| `pbs`                  | PBS              | runnable | reference-validated | PT DFS、partial-order UpdatePlan、2 段 CAT。3×2 fixture を author implementation と照合。[ノート](docs/notes/implementation/pbs.md)                               |
| `pibt`                 | PIBT             | runnable | reference-validated | Algorithm 1 と one-shot wrapper。2×2 rotation を pypibt と照合。[ノート](docs/notes/implementation/pibt.md)                                                       |
| `winpibt`              | winPIBT          | runnable | paper-faithful      | Algorithms 1–2、disentangled provisional paths、retroactive inheritance。[ノート](docs/notes/implementation/winpibt.md)                                           |
| `icts`                 | ICTS             | runnable | paper-faithful      | ICT BFS、exact-cost MDD、k-agent search、pairwise pruning。[ノート](docs/notes/implementation/icts.md)                                                            |
| `mstar`                | M*               | runnable | paper-faithful      | basic M*、limited neighbors、collision-set backpropagation。[ノート](docs/notes/implementation/mstar.md)                                                          |
| `push-and-swap`        | Push and Swap    | runnable | paper-faithful      | push / clear / multipush / exchange / reverse。後続論文の反例を反映。[ノート](docs/notes/implementation/push-and-swap.md)                                         |
| `push-and-rotate`      | Push and Rotate  | runnable | paper-faithful      | subproblem 分解・priority と push / swap / rotate / resolve。[ノート](docs/notes/implementation/push-and-rotate.md)                                               |
| `lacam`                | LaCAM            | runnable | paper-faithful      | Algorithm 1 の configuration DFS / constraint BFS と PIBT 型 generator。[ノート](docs/notes/implementation/lacam.md)                                              |
| `lacam-star`           | LaCAM*           | runnable | reference-validated | Algorithm 3 の rewiring。3×2 fixture を pylacam と照合。[ノート](docs/notes/implementation/lacam-star.md)                                                         |
| `mapf-lns`             | MAPF-LNS         | runnable | paper-faithful      | initial solution、agent/map/random neighborhood、repair、ALNS 重み。[ノート](docs/notes/implementation/mapf-lns.md)                                               |
| `mapf-lns2`            | MAPF-LNS2        | runnable | paper-faithful      | collision-pair repair、failure/random neighborhood、CP 非増加受理。[ノート](docs/notes/implementation/mapf-lns2.md)                                               |
| `rhcr`                 | RHCR             | runnable | educational         | planning window `w` / replanning period `h`、goal queue、throughput。Multi-Label A* と online task assigner は未対応。[ノート](docs/notes/implementation/rhcr.md) |
| `tapf-baseline`        | 全探索割当 + CBS | runnable | educational         | **サイト独自の参照実装で、論文手法ではない。** TAPF の入り口と Batch 7 の最適性検証用。[ノート](docs/notes/implementation/tapf-baseline.md)                       |
| `mapd-greedy`          | 貪欲割当（MAPD） | runnable | educational         | **サイト独自で、論文手法ではない。** MAPD 実行ループの土台と Batch 8 の対照用。[ノート](docs/notes/implementation/mapd-loop.md)                                   |
| `token-passing`        | TP               | runnable | educational         | 明示的 token、Path1 / Path2、MLA* low-level。well-formed 条件付き solvability。[ノート](docs/notes/implementation/token-passing.md)                               |
| `tpts`                 | TPTS             | runnable | educational         | TP 共通 token、前 step を含む未 pickup assignment swap、Path2。well-formed 条件付き solvability。[ノート](docs/notes/implementation/tpts.md)                      |
| `central`              | CENTRAL          | runnable | educational         | Hungarian + MLA* の centralized strawman。解決性・最適性保証なし。[ノート](docs/notes/implementation/central.md)                                                  |
| `min-cost-max-flow`    | 最小費用最大流   | runnable | paper-faithful      | 1 チーム TAPF の時空間 flow。CBM の low-level。[ノート](docs/notes/implementation/min-cost-max-flow.md)                                                           |
| `cbm`                  | CBM              | runnable | paper-faithful      | team MCMF + CBS。目的は makespan。[ノート](docs/notes/implementation/cbm.md)                                                                                      |
| `cbs-ta`               | CBS-TA           | runnable | educational         | assignment matrix + CBS。全候補列挙の教育用実装。目的は sum of costs。[ノート](docs/notes/implementation/cbs-ta.md)                                               |
| `lns-pbs`              | LNS-PBS          | runnable | educational         | MG-MAPD の task sequence / multi-goal 教育骨格。well-formed 条件付き。[ノート](docs/notes/implementation/lns-pbs.md)                                              |
| `lns-wpbs`             | LNS-wPBS         | runnable | educational         | w=10（extra で変更可）の rolling-window sequence planner。探索は goal まで、予約は窓内。完全性保証なし。[ノート](docs/notes/implementation/lns-wpbs.md)           |
| `rmca`                 | RMCA             | runnable | educational         | capacity / TTD / regret insertion。[ノート](docs/notes/implementation/rmca.md)                                                                                    |

---

## 未実装（解説ページのみ存在）

以下の手法はページの骨格だけ、または単体 Solver ではない内部ライブラリで、`status: planned` / `library` / `explanation-only`。
実装状況は `docs/sources/algorithms.yaml` の `implementation_status` を参照。

| バッチ  | 対象                                                                         |
| ------- | ---------------------------------------------------------------------------- |
| Batch 7 | `hungarian-method`, `gale-shapley`（library。CBS-TA などから利用）           |
| Batch 8 | `mla-star`, `hbh`（library）、`token-passing`, `tpts`, `central`（runnable） |
| Batch 9 | `regret-insertion`（library。RMCA の内部部品）                               |
| 最後    | `primal`, `primal2`                                                          |

`primal` / `primal2` は学習済みモデルとライセンスを確認できない限り
**`explanation-only` のまま**にすること。

## 内部ライブラリ（単体では実行不可）

| algorithm-id       | 実装                                     | 利用先                                   |
| ------------------ | ---------------------------------------- | ---------------------------------------- |
| `hungarian-method` | `src/lib/assignment/hungarian.ts`        | CBS-TA の assignment 候補順序            |
| `gale-shapley`     | `src/lib/assignment/gale-shapley.ts`     | 安定マッチングの教材用純関数             |
| `mla-star`         | `src/solvers/mapd/mla-star.ts`           | TP / TPTS / CENTRAL / HBH の低レベル探索 |
| `hbh`              | `src/solvers/mapd/strategies.ts`         | 中央 assignment の内部 heuristic         |
| `regret-insertion` | `src/lib/assignment/regret-insertion.ts` | RMCA の task ordering                    |

これらは実装が無いという意味ではない。シミュレータから直接動かせないため、UI では
「内部実装あり（単体では実行不可）」と表示する。

---

## 理論保証の確定状況

`docs/sources/algorithms.yaml` の `guarantees` に `unknown` が残っている手法: **54 / 77**。

根拠つきで確定済みなのは 39 手法（`guarantee_evidence` が入っているもの）。
主なもの:

| algorithm-id           | 完全性   | 最適性             | 根拠                                                                    |
| ---------------------- | -------- | ------------------ | ----------------------------------------------------------------------- |
| `cbs`                  | 条件付き | 最適               | cbs-aij-2015 Theorem 1 / 3、§5.2.2                                      |
| `icbs`                 | 条件付き | 最適               | icbs-ijcai-2015 pp.1, 4。CBS と coupled low level に依存                |
| `mstar`                | あり     | 最適               | mstar-aij-2015 Theorem 1                                                |
| `ccbs`                 | あり     | 最適               | ccbs-ijcai-2019 アブストラクト                                          |
| `cbm`                  | あり     | 最適               | cbm-tapf-aamas-2016 p.6                                                 |
| `cbs-ta`               | あり     | 最適               | cbs-ta-aamas-2018 Theorem 4.1 / 4.2                                     |
| `hungarian-method`     | あり     | 最適               | hungarian-method-1955 pp.89–90 Theorem 7 / Routine I                    |
| `gale-shapley`         | あり     | 条件付き           | gale-shapley-1962 pp.5, 7 Theorem 1 / 2                                 |
| `min-cost-max-flow`    | 条件付き | 条件付き           | network-flow-mapf-2012 p.9 Corollary 23 / 25                            |
| `token-passing`        | 条件付き | 不明               | mapd-tp-tpts-central-2017 p.4 Theorem 3（well-formed 前提）             |
| `tpts`                 | 条件付き | 不明               | mapd-tp-tpts-central-2017 p.5 Theorem 5（well-formed 前提）             |
| `central`              | なし     | なし               | mapd-tp-tpts-central-2017 p.5 §5 の明示的な否定                         |
| `mla-star` / `hbh`     | 不明     | 不明               | mla-star-icaps-2019 の Algorithm 1 / 2 を確認したが保証定理なし         |
| `bcbs` `ecbs`          | あり     | なし（有界準最適） | bcbs-ecbs-socs-2014 p.6                                                 |
| `eecbs`                | 不明     | なし（有界準最適） | eecbs-aaai-2021 p.5 式 (2)                                              |
| `pibt`                 | 条件付き | なし               | pibt-aij-2022 p.3「neither complete nor optimal for MAPF」              |
| `pbs`                  | 不明     | なし               | pbs-aaai-2019 Algorithm 2 / p.7 の 4% は実験観測で保証ではない          |
| `winpibt`              | 条件付き | 不明               | winpibt-2019 p.7 Theorem 4.3。dodgeable + finite window の reachability |
| `lacam`                | あり     | なし               | lacam-aaai-2023 p.3 Theorem 1 / p.1 sub-optimal                         |
| `lacam-star`           | あり     | 条件付き           | p.4 OPEN 完了時 optimal / 中断時 sub-optimal。対象は sum-of-loss        |
| `push-and-rotate`      | 条件付き | なし               | 空き頂点が 2 つ以上（k ≤ \|V\| − 2）                                    |
| `push-and-swap`        | なし     | なし               | 後続 Push and Rotate 論文が原論文 Theorem 3.1 の同一条件内反例を提示    |
| `icts`                 | 不明     | 最適               | icts-ijcai-2011 p.1 Abstract / p.2 §4。有限 no-solution 証明は未確認    |
| `sipp`                 | あり     | time-minimal       | sipp-icra-2011 p.5 Theorem 1 / 2                                        |
| `prioritized-planning` | なし     | なし               | pbs-aaai-2019 p.2 Theorem 1、p.3 Theorem 4 / Corollary 5                |
| `cooperative-astar`    | なし     | 不明               | cooperative-pathfinding-2005 p.2 Figure 1 と本文                        |
| `hca-star`             | なし     | 不明               | 同 p.2 の限界と p.3 の「CA* の heuristic 置換」                         |
| `mapf-lns`             | 不明     | なし               | mapf-lns-ijcai-2021 p.1 の “with no guarantee”                          |
| `mapf-lns2`            | なし     | なし               | mapf-lns2-aaai-2022 p.1 abstract の “lacks theoretical guarantees”      |
| `rhcr`                 | なし     | なし               | rhcr-aaai-2021 §4.4 p.6、結論 p.8                                       |
| `lns-pbs`              | 条件付き | 不明               | mg-mapd-iros-2022 p.5 Theorem 1（well-formed MG-MAPD、有限 task 前提）  |
| `lns-wpbs`             | なし     | 不明               | mg-mapd-iros-2022 p.1 abstract（completeness guarantee なし）           |
| `rmca`                 | 不明     | 不明               | rmca-ral-2021 p.3 の TTD 定式化は確認したが、保証定理は確認できず       |

**PDF を読んで新たに確定した保証は、実装ノートに書くだけでなく
`algorithms.yaml` の `guarantees` と `guarantee_evidence` へ必ず書き戻すこと。**
サイトの保証表はマニフェストだけを見ている。

---

## 検証に使える道具

| 道具                        | 場所                                                      | 用途                                                             |
| --------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| makespan 最適オラクル       | `src/solvers/reference/joint-state.ts` の `jointStateBfs` | 構成グラフ上の BFS。makespan 最適を保証                          |
| SOC 最適オラクル            | 同 `jointStateOptimalSumOfCosts`                          | IDA*。`sumOfCostsCertified` が true のときだけ最適を主張してよい |
| 解の不変条件チェック        | `tests/helpers/check-paths.ts` の `checkPaths()`          | 壁通過・跳躍・衝突・ゴール未到達をまとめて検査                   |
| marker.md と PDF の機械照合 | `npm run sources:fidelity`                                | 丸ごと落ちた Algorithm / Theorem / Figure を検出                 |

オラクルは**極小インスタンス専用**（エージェント 5 体 / 通行可能セル 36 以下）。
超えると `ReferenceSolverTooLarge` を投げる。黙って間違った答えを返さない設計にしてある。

---

## 更新方法

バッチを終えたら、このファイルの次を更新する。

1. 「実装済み」の表に行を足す（`status` と `fidelity` を正確に）
2. 「未実装」からその手法を消す
3. 理論保証を確定させたら「理論保証の確定状況」の件数と表を更新する
4. `docs/notes/implementation/<algorithm-id>.md` へのリンクを備考に書く
