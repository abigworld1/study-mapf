# SOURCE_ACQUISITION.md — 原論文の取得と Marker 変換

**PDF と Marker Markdown は 52 本すべて配置済み（2026-07-26）。**
残る作業は PDF との照合（`marker-ready` → `verified`）である。

| 段階 | 件数 |
|---|---|
| PDF 取得済み | 52 / 52 |
| Marker 変換済み | 52 / 52 |
| PDF 照合済み (`verified`) | 0 / 52 |

---

## 次の作業 — PDF 照合

Marker は数式・擬似コード・表を高頻度で壊す（SOURCE_POLICY.md 第 5 条）。
`marker.md` は全文検索と当たりをつけるための索引であって、根拠ではない。
サイト本文に手法の定義・擬似コード・保証を書く前に、次を済ませること。

1. `paper.pdf` を開き、`marker.md` の Algorithm ブロック・数式・表を目視照合する
2. `docs/papers/<id>/metadata.yaml` の `reading` にページ番号・節番号・Algorithm 番号を記録する
3. `verification.checked_against_pdf` を `true`、`checked_by` / `checked_at` を記入する
4. `papers.yaml` の `status` を `verified` にする
5. `node scripts/validate-sources.mjs` が 0 error で通ることを確認する

```yaml
reading:
  algorithm_blocks:
    - { name: "CBS high level", page: 5, label: "Algorithm 1" }
  key_theorems:
    - { statement: "optimality", page: 12, label: "Theorem 1" }
```

### 配置済みのディレクトリ

```text
docs/papers/<paper-id>/
├── paper.pdf          # .gitignore で除外
├── marker.md          # 配置済み
├── marker_meta.json   # ★ 1 件も無い（Marker が出力していない）
├── metadata.yaml      # acquired 記入済み。reading / verification は未記入
└── images/            # 計 377 枚
```

---

## ★ 変換結果に注意が要る論文

誌面スキャン由来の混入・OCR の崩れがあるもの。**本文は PDF とのページ対応を保つため削っていない。**
詳細は各 `docs/papers/<id>/metadata.yaml` の `verification.notes` にある。

| paper-id | 内容 |
|---|---|
| `astar-1968` | marker.md の 1-62 行目は本論文ではなく、同誌の前の論文（非線形計画法）の参考文献リストである。IEEE Trans. SSC vol.4 no.2 の p.100 が前論文の末尾と重なっているため。本論文の本文は 63 行目「# A Formal Basis for the Heuristic Determination of Minimum Cost Paths」から 418 行目まで。PDF とのページ対応を保つため混入部分はあえて削っていない。全文検索するときは 63 行目以降に限定すること。 |
| `cbs-aij-2015` | marker.md の先頭は Elsevier の誌面ヘッダ（Artificial Intelligence / Contents lists available at ScienceDirect）で、論文タイトルはその直後にある。混入ではなく掲載誌のレイアウトどおり。 |
| `pbs-aaai-2019` | ★ 機械照合で欠落を検出: PDF の Figure 5・6・7・8（いずれも実験結果の図）が marker.md に存在せず、語数も PDF 比 78% に留まる（他論文は 100-105%）。Experiments 節の本文が大きく脱落している。アルゴリズム定義（Priority-Based Search 節）と Theoretical Results 節は残っているため手法の解説には使えるが、性能に関する記述を書くときは必ず paper.pdf を参照すること。Marker で再変換すれば改善する可能性がある。 |
| `hungarian-method-1955` | ★ 機械照合で欠落を検出: PDF には THEOREM 2（There is an assignment which is complete after ...）と THEOREM 4（There is an adequate budget and an assignment ...）があるが、marker.md には存在しない。1955 年の誌面スキャンを OCR したため脱落したと見られる。この 2 定理を引用する場合は必ず paper.pdf を直接読むこと。他の THEOREM 1/3/5/6/7 と LEMMA 1/2/3 は marker.md にある（大文字表記）。 |
| `gale-shapley-1962` | marker.md の 1-28 行目は JSTOR の前付け（Accessibility support 等の閲覧条件）、145-150 行目は次の論文「GRADUATED INTEREST RATES IN SMALL LOANS」(Hugh E. Stelson) である。本論文の本文は 29-144 行目。PDF とのページ対応を保つため混入部分はあえて削っていない。全文検索するときは 29-144 行目に限定すること。 |
| `auction-algorithm-1988` | 誌面スキャンの OCR のため記号と見出しに崩れがある（実例: 「1. INTRODUf;rION」「rnin-cost」「nonline;ar」「(-relaxation」）。本文の意味は追えるが、数式・アルゴリズム番号・epsilon 記号を引用する際は必ず paper.pdf と照合すること。 |

---

## 再配布可否

| status | 件数 | サイトでの扱い |
|---|---|---|
| `allowed` | 5 | PDF を同梱してよい。ライセンス条件は守る |
| `link-only` | 44 | 外部リンクのみ |
| `unknown` | 3 | 外部リンクのみ |

`paper.pdf` は `.gitignore` で除外済み。判定できていない 3 本は次のとおり。

- `mstar-aij-2015` — http://biorobotics.ri.cmu.edu/papers/paperUploads/subdim_journal.pdf
- `sipp-icra-2011` — https://www.cs.cmu.edu/~maxim/files/sipp_icra11.pdf
- `auction-algorithm-1988` — https://www.mit.edu/~dimitrib/TheAuctionAP.pdf

---

## 全 52 本の一覧

| 優先度 | paper-id | 対象手法 | 論文タイトル | 頁 | md行数 | 画像 | 再配布 | status |
|---|---|---|---|---|---|---|---|---|
| P0 | `astar-1968` ★ | A* | A Formal Basis for the Heuristic Determination of Minimum Cost Paths | 8 | 419 | 2 | `link-only` | `marker-ready` |
| P0 | `cbs-aaai-2012` | CBS (Conflict-Based Search) | Conflict-Based Search For Optimal Multi-Agent Path Finding | 7 | 288 | 3 | `link-only` | `marker-ready` |
| P0 | `cbs-aij-2015` ★ | CBS (Conflict-Based Search) / MA-CBS (Meta-Agent CBS) | Conflict-based search for optimal multi-agent pathfinding | 27 | 833 | 15 | `link-only` | `marker-ready` |
| P0 | `cooperative-pathfinding-2005` | Cooperative A* (CA*) / HCA* (Hierarchical Cooperative A*) / WHCA* (Windowed Hierarchical Cooperative A*) / 予約テーブル (Reservation Table) | Cooperative Pathfinding | 6 | 219 | 7 | `link-only` | `marker-ready` |
| P0 | `dijkstra-1959` | Dijkstra 法 | A note on two problems in connexion with graphs | 3 | 73 | 0 | `link-only` | `marker-ready` |
| P0 | `mapf-benchmarks-2019` | MAPF 問題定義 / MovingAI MAPF ベンチマーク | Multi-Agent Pathfinding: Definitions, Variants, and Benchmarks | 8 | 298 | 7 | `link-only` | `marker-ready` |
| P0 | `pbs-aaai-2019` ★ | PBS (Priority-Based Search) / 優先順位付き計画 (Prioritized Planning) | Searching with Consistent Prioritization for Multi-Agent Path Finding | 8 | 298 | 4 | `link-only` | `marker-ready` |
| P0 | `sipp-icra-2011` | SIPP (Safe Interval Path Planning) | SIPP: Safe Interval Path Planning for Dynamic Environments | 8 | 259 | 12 | `unknown` | `marker-ready` |
| P0 | `standley-od-id-2010` | Operator Decomposition (OD) / Independence Detection (ID) / 結合状態 A* (Joint-State A*) | Finding Optimal Solutions to Cooperative Pathfinding Problems | 6 | 224 | 7 | `link-only` | `marker-ready` |
| P1 | `bcbs-ecbs-socs-2014` | BCBS (Bounded CBS) / ECBS (Enhanced CBS) / Focal Search | Suboptimal Variants of the Conflict-Based Search Algorithm for the Multi-Agent Pathfinding Problem | 9 | 354 | 6 | `link-only` | `marker-ready` |
| P1 | `cbsh-icaps-2018` | CBSH (CBS with Heuristics) | Adding Heuristics to Conflict-Based Search for Multi-Agent Path Finding | 5 | 164 | 4 | `link-only` | `marker-ready` |
| P1 | `cbsh2-ijcai-2019` | CBSH2 (改良ヒューリスティクス版 CBS) | Improved Heuristics for Multi-Agent Path Finding with Conflict-Based Search | 8 | 322 | 7 | `link-only` | `marker-ready` |
| P1 | `cbsh2-rtc-aij-2021` | CBSH2-RTC (対称性推論つき CBSH2) / 矩形対称性推論 (Rectangle Reasoning) / 回廊対称性推論 (Corridor Reasoning) / 目標対称性推論 (Target Reasoning) | Pairwise Symmetry Reasoning for Multi-Agent Path Finding Search | 65 | 1024 | 26 | `link-only` | `marker-ready` |
| P1 | `ccbs-ijcai-2019` | CCBS (Continuous-time CBS) / SIPP (Safe Interval Path Planning) | Multi-Agent Pathfinding with Continuous Time | 7 | 315 | 4 | `link-only` | `marker-ready` |
| P1 | `disjoint-splitting-icaps-2019` | Disjoint Splitting | Disjoint Splitting for Multi-Agent Path Finding with Conflict-Based Search | 5 | 208 | 4 | `link-only` | `marker-ready` |
| P1 | `eecbs-aaai-2021` | EECBS (Explicit Estimation CBS) / Focal Search | EECBS: A Bounded-Suboptimal Search for Multi-Agent Path Finding | 10 | 311 | 5 | `link-only` | `marker-ready` |
| P1 | `icbs-ijcai-2015` | ICBS (Improved CBS) / CBS の衝突バイパス (Bypassing Conflicts) / 衝突の優先順位付け (Prioritizing Conflicts) | ICBS: Improved Conflict-Based Search Algorithm for Multi-Agent Pathfinding | 7 | 252 | 4 | `link-only` | `marker-ready` |
| P1 | `icts-ijcai-2011` | ICTS (Increasing Cost Tree Search) | The Increasing Cost Tree Search for Optimal Multi-agent Pathfinding | 6 | 298 | 6 | `link-only` | `marker-ready` |
| P1 | `lacam-aaai-2023` | LaCAM / PIBT (Priority Inheritance with Backtracking) | LaCAM: Search-Based Algorithm for Quick Multi-Agent Pathfinding | 8 | 292 | 6 | `link-only` | `marker-ready` |
| P1 | `lacam-star-ijcai-2023` | LaCAM* | Improving LaCAM for Scalable Eventually Optimal Multi-Agent Pathfinding | 9 | 434 | 10 | `link-only` | `marker-ready` |
| P1 | `lacam3-aamas-2024` | LaCAM3 (Engineering LaCAM*) | Engineering LaCAM*: Towards Real-Time, Large-Scale, and Near-Optimal Multi-Agent Pathfinding | 9 | 394 | 11 | `allowed` | `marker-ready` |
| P1 | `ma-cbs-socs-2012` | MA-CBS (Meta-Agent CBS) | Meta-Agent Conflict-Based Search For Optimal Multi-Agent Path Finding | 8 | 329 | 2 | `link-only` | `marker-ready` |
| P1 | `mapf-lns-ijcai-2021` | MAPF-LNS | Anytime Multi-Agent Path Finding via Large Neighborhood Search | 9 | 366 | 5 | `link-only` | `marker-ready` |
| P1 | `mapf-lns2-aaai-2022` | MAPF-LNS2 / SIPPS (SIPP with Soft constraints) | MAPF-LNS2: Fast Repairing for Multi-Agent Path Finding via Large Neighborhood Search | 10 | 346 | 6 | `link-only` | `marker-ready` |
| P1 | `mstar-aij-2015` | M* / Recursive M* (rM*) | Subdimensional expansion for multirobot path planning | 56 | 733 | 23 | `unknown` | `marker-ready` |
| P1 | `pibt-aij-2022` | PIBT (Priority Inheritance with Backtracking) | Priority Inheritance with Backtracking for Iterative Multi-agent Path Finding | 32 | 648 | 13 | `allowed` | `marker-ready` |
| P1 | `push-and-rotate-aamas-2013` | Push and Rotate | Push and Rotate: Cooperative Multi-Agent Path Planning | 8 | 453 | 11 | `link-only` | `marker-ready` |
| P1 | `push-and-swap-ijcai-2011` | Push and Swap | Push and Swap: Fast Cooperative Path-Finding with Completeness Guarantees | 7 | 322 | 10 | `link-only` | `marker-ready` |
| P1 | `winpibt-2019` | winPIBT | winPIBT: Extended Prioritized Algorithm for Iterative Multi-agent Path Finding | 9 | 370 | 7 | `link-only` | `marker-ready` |
| P2 | `cbm-tapf-aamas-2016` | CBM (Conflict-Based Min-Cost-Flow) / TAPF 問題定義 / 最小費用最大流 (Min-Cost Max-Flow) | Optimal Target Assignment and Path Finding for Teams of Agents | 9 | 374 | 11 | `link-only` | `marker-ready` |
| P2 | `cbs-ta-aamas-2018` | CBS-TA | Conflict-Based Search with Optimal Task Assignment | 9 | 386 | 8 | `link-only` | `marker-ready` |
| P2 | `gale-shapley-1962` ★ | Gale-Shapley 法 (安定マッチング) | College Admissions and the Stability of Marriage | 8 | 151 | 3 | `link-only` | `marker-ready` |
| P2 | `hungarian-method-1955` ★ | ハンガリアン法 (Hungarian Method) | The Hungarian method for the assignment problem | 15 | 444 | 9 | `link-only` | `marker-ready` |
| P2 | `mapd-tp-tpts-central-2017` | TP (Token Passing) / TPTS (Token Passing with Task Swaps) / CENTRAL / MAPD 問題定義 | Lifelong Multi-Agent Path Finding for Online Pickup and Delivery Tasks | 9 | 389 | 7 | `link-only` | `marker-ready` |
| P2 | `mg-mapd-iros-2022` | LNS-PBS / LNS-wPBS | Multi-Goal Multi-Agent Pickup and Delivery | 8 | 318 | 4 | `link-only` | `marker-ready` |
| P2 | `mla-star-icaps-2019` | MLA* (Multi-Label A*) / HBH (Hungarian-Based Heuristic) | A Multi-Label A* Algorithm for Multi-Agent Pathfinding | 5 | 218 | 2 | `link-only` | `marker-ready` |
| P2 | `rhcr-aaai-2021` | RHCR (Rolling-Horizon Collision Resolution) / Lifelong MAPF 問題定義 | Lifelong Multi-Agent Path Finding in Large-Scale Warehouses | 10 | 335 | 7 | `link-only` | `marker-ready` |
| P2 | `rmca-ral-2021` | RMCA / Regret 挿入法 (Regret Insertion) | Integrated Task Assignment and Path Planning for Capacitated Multi-Agent Pickup and Delivery | 8 | 415 | 6 | `allowed` | `marker-ready` |
| P2 | `sippwrt-aaai-2019` | SIPPwRT (SIPP with Reservation Table) | Lifelong Path Planning with Kinematic Constraints for Multi-Agent Pickup and Delivery | 9 | 323 | 6 | `link-only` | `marker-ready` |
| P2 | `ta-prioritized-hybrid-aamas-2019` | TA-Prioritized / TA-Hybrid | Task and Path Planning for Multi-Agent Pickup and Delivery | 9 | 375 | 10 | `link-only` | `marker-ready` |
| P3 | `auction-algorithm-1988` ★ | オークションアルゴリズム (Auction Algorithm) | The auction algorithm: A distributed relaxation method for the assignment problem | 19 | 359 | 11 | `unknown` | `marker-ready` |
| P3 | `bcp-ijcai-2019` | BCP (Branch-and-Cut-and-Price) | Branch-and-Cut-and-Price for Multi-Agent Pathfinding | 8 | 326 | 4 | `link-only` | `marker-ready` |
| P3 | `compilation-survey-2022` | MDD-SAT / SMT-CBS / BCP (Branch-and-Cut-and-Price) | Problem Compilation for Multi-Agent Path Finding: a Survey | 8 | 400 | 1 | `link-only` | `marker-ready` |
| P3 | `ita-cbs-mrs-2023` | ITA-CBS | Solving Multi-Agent Target Assignment and Path Finding with a Single Constraint Tree | 7 | 254 | 5 | `allowed` | `marker-ready` |
| P3 | `ita-ecbs-socs-2024` | ITA-ECBS | ITA-ECBS: A Bounded-Suboptimal Algorithm for Combined Target-Assignment and Path-Finding Problem | 9 | 291 | 6 | `link-only` | `marker-ready` |
| P3 | `lns-reevaluation-socs-2025` | MAPF-LNS / MAPF-LNS2 / MAPF-ML-LNS (機械学習誘導 LNS) | Reevaluation of Large Neighborhood Search for MAPF: Findings and Opportunities | 15 | 700 | 4 | `link-only` | `marker-ready` |
| P3 | `mdd-sat-ecai-2016` | MDD-SAT | Efficient SAT Approach to Multi-Agent Path Finding Under the Sum of Costs Objective | 9 | 357 | 13 | `allowed` | `marker-ready` |
| P3 | `ml-lns-aaai-2022` | MAPF-ML-LNS (機械学習誘導 LNS) | Anytime Multi-Agent Path Finding via Machine Learning-Guided Large Neighborhood Search | 9 | 348 | 2 | `link-only` | `marker-ready` |
| P3 | `network-flow-mapf-2012` | 最小費用最大流 (Min-Cost Max-Flow) | Multi-agent Path Planning and Network Flow | 12 | 420 | 12 | `link-only` | `marker-ready` |
| P3 | `primal-ral-2019` | PRIMAL | PRIMAL: Pathfinding via Reinforcement and Imitation Multi-Agent Learning | 9 | 234 | 7 | `link-only` | `marker-ready` |
| P3 | `primal2-ral-2021` | PRIMAL2 | PRIMAL2: Pathfinding via Reinforcement and Imitation Multi-Agent Learning - Lifelong | 9 | 258 | 6 | `link-only` | `marker-ready` |
| P3 | `smt-cbs-ijcai-2019` | SMT-CBS | Unifying Search-based and Compilation-based Approaches to Multi-agent Path Finding through Satisfiability Modulo Theories | 7 | 388 | 6 | `link-only` | `marker-ready` |

★ = 変換結果に注意が要る論文（上記参照）

---

## 照合チェックリスト（52 本）

### P0（9 本）

- [ ] `astar-1968` — A* ★
- [ ] `dijkstra-1959` — Dijkstra
- [ ] `mapf-benchmarks-2019` — MAPF Definitions & Benchmarks
- [ ] `cooperative-pathfinding-2005` — Cooperative Pathfinding (CA*/HCA*/WHCA*)
- [ ] `cbs-aij-2015` — CBS (journal) ★
- [ ] `cbs-aaai-2012` — CBS (AAAI 2012)
- [ ] `pbs-aaai-2019` — PBS ★
- [ ] `standley-od-id-2010` — OD + ID
- [ ] `sipp-icra-2011` — SIPP

### P1（20 本）

- [ ] `ma-cbs-socs-2012` — MA-CBS
- [ ] `bcbs-ecbs-socs-2014` — BCBS / ECBS
- [ ] `icbs-ijcai-2015` — ICBS
- [ ] `eecbs-aaai-2021` — EECBS
- [ ] `ccbs-ijcai-2019` — CCBS
- [ ] `cbsh-icaps-2018` — CBSH
- [ ] `cbsh2-ijcai-2019` — CBSH2
- [ ] `cbsh2-rtc-aij-2021` — CBSH2-RTC
- [ ] `disjoint-splitting-icaps-2019` — Disjoint Splitting
- [ ] `pibt-aij-2022` — PIBT
- [ ] `winpibt-2019` — winPIBT
- [ ] `lacam-aaai-2023` — LaCAM
- [ ] `lacam-star-ijcai-2023` — LaCAM*
- [ ] `lacam3-aamas-2024` — LaCAM3
- [ ] `push-and-swap-ijcai-2011` — Push and Swap
- [ ] `push-and-rotate-aamas-2013` — Push and Rotate
- [ ] `icts-ijcai-2011` — ICTS
- [ ] `mstar-aij-2015` — M*
- [ ] `mapf-lns-ijcai-2021` — MAPF-LNS
- [ ] `mapf-lns2-aaai-2022` — MAPF-LNS2

### P2（11 本）

- [ ] `rhcr-aaai-2021` — RHCR
- [ ] `mapd-tp-tpts-central-2017` — MAPD (TP / TPTS / CENTRAL)
- [ ] `ta-prioritized-hybrid-aamas-2019` — TA-Prioritized / TA-Hybrid
- [ ] `mla-star-icaps-2019` — MLA*
- [ ] `rmca-ral-2021` — RMCA
- [ ] `mg-mapd-iros-2022` — MG-MAPD (LNS-PBS / LNS-wPBS)
- [ ] `sippwrt-aaai-2019` — SIPPwRT
- [ ] `cbm-tapf-aamas-2016` — CBM
- [ ] `cbs-ta-aamas-2018` — CBS-TA
- [ ] `hungarian-method-1955` — Hungarian Method ★
- [ ] `gale-shapley-1962` — Gale-Shapley ★

### P3（12 本）

- [ ] `compilation-survey-2022` — Compilation Survey
- [ ] `bcp-ijcai-2019` — BCP
- [ ] `mdd-sat-ecai-2016` — MDD-SAT
- [ ] `smt-cbs-ijcai-2019` — SMT-CBS
- [ ] `ml-lns-aaai-2022` — MAPF-ML-LNS
- [ ] `lns-reevaluation-socs-2025` — LNS Reevaluation
- [ ] `ita-cbs-mrs-2023` — ITA-CBS
- [ ] `ita-ecbs-socs-2024` — ITA-ECBS
- [ ] `auction-algorithm-1988` — Auction Algorithm ★
- [ ] `network-flow-mapf-2012` — Network Flow MAPF
- [ ] `primal-ral-2019` — PRIMAL
- [ ] `primal2-ral-2021` — PRIMAL2

規約は [SOURCE_POLICY.md](SOURCE_POLICY.md)、マニフェストの読み方は [docs/README.md](docs/README.md)。
