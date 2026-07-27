# IMPLEMENTATION_STATUS.md

アルゴリズムごとの実装状況。**バッチを終えるたびに更新すること。**

最終更新: 2026-07-27（Codex / Batch 2 完了）

---

## 見方

2 つの軸を分けて記録する。混同しない。

| 軸                    | 値                    | 意味                             |
| --------------------- | --------------------- | -------------------------------- |
| **実装状態** `status` | `runnable`            | シミュレータで動く               |
|                       | `partial`             | 動くが原論文の一部のみ           |
|                       | `explanation-only`    | 実装なし。解説と出典だけ         |
|                       | `planned`             | 骨格だけ                         |
| **再現度** `fidelity` | `educational`         | 原理を学ぶための簡略実装         |
|                       | `paper-faithful`      | 原論文の主要処理を実装した       |
|                       | `reference-validated` | 公開実装または既知結果と照合済み |
|                       | `explanation-only`    | 実行可能な再現実装なし           |

**一部だけ実装した状態を `reference-validated` にしない。**
照合したのが「何を」なのかを `validatedAgainst` と `implementationNote` に書く。

解説ページの正確性は別軸（`draft` / `reviewed` / `verified`）。MDX の frontmatter で管理する。

---

## 実装済み（registry に登録されている）

| algorithm-id           | 手法             | status   | fidelity       | 備考                                                                                              |
| ---------------------- | ---------------- | -------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `bfs`                  | 幅優先探索       | runnable | educational    | 各エージェント独立。衝突は解消しない                                                              |
| `astar`                | A*               | runnable | educational    | 同上。ヒューリスティクスの効果を見るため                                                          |
| `space-time-astar`     | 時空間 A*        | runnable | paper-faithful | 単一 agent の `(cell,time)` 探索。[ノート](docs/notes/implementation/space-time-astar.md)         |
| `sipp`                 | SIPP             | runnable | paper-faithful | safe interval 探索。MAPF wrapper は固定順。[ノート](docs/notes/implementation/sipp.md)            |
| `prioritized-planning` | 優先順位付き計画 | runnable | paper-faithful | 固定全順序。PBS の順序探索は含まない。[ノート](docs/notes/implementation/prioritized-planning.md) |
| `cooperative-astar`    | Cooperative A*   | runnable | paper-faithful | Manhattan + reservation table。[ノート](docs/notes/implementation/cooperative-astar.md)           |
| `hca-star`             | HCA*             | runnable | paper-faithful | Algorithm 1 の on-demand RRA*。[ノート](docs/notes/implementation/hca-star.md)                    |
| `whca-star`            | WHCA*            | runnable | paper-faithful | terminal edge、rolling window、RRA* 再利用。[ノート](docs/notes/implementation/whca-star.md)      |
| `cbs`                  | CBS              | runnable | paper-faithful | standard split、SOC best-first、CAT。[ノート](docs/notes/implementation/cbs.md)                   |
| `bcbs`                 | BCBS             | runnable | paper-faithful | high / low focal、保証係数 `wH*wL`。[ノート](docs/notes/implementation/bcbs.md)                   |
| `ecbs`                 | ECBS             | runnable | paper-faithful | low-level `fMin` の和を CT lower bound に使用。[ノート](docs/notes/implementation/ecbs.md)        |
| `icbs`                 | ICBS (PC+BP)     | partial  | paper-faithful | PC と helpful BP。MA-CBS / MR は未対応。[ノート](docs/notes/implementation/icbs.md)               |
| `eecbs`                | EECBS            | runnable | paper-faithful | §3 の EES 3-list と online error。§4 改善は未対応。[ノート](docs/notes/implementation/eecbs.md)   |

---

## 未実装（解説ページのみ存在）

以下 23 手法はページの骨格だけがあり、`status: planned` または `explanation-only`。
実装状況は `docs/sources/algorithms.yaml` の `implementation_status` を参照。

| バッチ  | 対象                                                                     |
| ------- | ------------------------------------------------------------------------ |
| Batch 3 | `pbs`, `pibt`, `winpibt`                                                 |
| Batch 4 | `icts`, `mstar`, `push-and-swap`, `push-and-rotate`                      |
| Batch 5 | `lacam`, `lacam-star`                                                    |
| Batch 6 | `mapf-lns`, `mapf-lns2`, `rhcr`                                          |
| Batch 7 | `hungarian-method`, `min-cost-max-flow`, `gale-shapley`, `cbm`, `cbs-ta` |
| Batch 8 | `token-passing`, `tpts`, `central`, `mla-star`                           |
| Batch 9 | `rmca`, `lns-pbs`, `lns-wpbs`                                            |
| 最後    | `primal`, `primal2`                                                      |

`primal` / `primal2` は学習済みモデルとライセンスを確認できない限り
**`explanation-only` のまま**にすること。

---

## 理論保証の確定状況

`docs/sources/algorithms.yaml` の `guarantees` に `unknown` が残っている手法: **58 / 77**。

根拠つきで確定済みなのは 29 手法（`guarantee_evidence` が入っているもの）。
主なもの:

| algorithm-id           | 完全性   | 最適性             | 根拠                                                            |
| ---------------------- | -------- | ------------------ | --------------------------------------------------------------- |
| `cbs`                  | 条件付き | 最適               | cbs-aij-2015 Theorem 1 / 3、§5.2.2                              |
| `icbs`                 | 条件付き | 最適               | icbs-ijcai-2015 pp.1, 4。CBS と coupled low level に依存        |
| `mstar`                | あり     | 最適               | mstar-aij-2015 Theorem 1                                        |
| `ccbs`                 | あり     | 最適               | ccbs-ijcai-2019 アブストラクト                                  |
| `cbm`                  | あり     | 最適               | cbm-tapf-aamas-2016 p.6                                         |
| `cbs-ta`               | あり     | 最適               | cbs-ta-aamas-2018 Theorem 4.1 / 4.2                             |
| `bcbs` `ecbs`          | あり     | なし（有界準最適） | bcbs-ecbs-socs-2014 p.6                                         |
| `eecbs`                | 不明     | なし（有界準最適） | eecbs-aaai-2021 p.5 式 (2)                                      |
| `pibt`                 | 条件付き | なし               | pibt-aij-2022 p.3「neither complete nor optimal for MAPF」      |
| `lacam-star`           | あり     | 条件付き           | 本文は「complete and optimal」だがタイトルは Eventually Optimal |
| `push-and-rotate`      | 条件付き | なし               | 空き頂点が 2 つ以上（k ≤ \|V\| − 2）                            |
| `sipp`                 | あり     | time-minimal       | sipp-icra-2011 p.5 Theorem 1 / 2                                |
| `prioritized-planning` | なし     | なし               | pbs-aaai-2019 p.2 Theorem 1、p.3 Theorem 4 / Corollary 5        |
| `cooperative-astar`    | なし     | 不明               | cooperative-pathfinding-2005 p.2 Figure 1 と本文                |
| `hca-star`             | なし     | 不明               | 同 p.2 の限界と p.3 の「CA* の heuristic 置換」                 |

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
