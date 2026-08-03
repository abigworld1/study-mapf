# Codex 用プロンプト — Batch 9（容量制約つき / 多目的地 MAPD）

> このファイルは Codex へそのまま貼るためのもの。`---` 以下を全部コピーして使う。
> [CODEX_PROMPT.md](CODEX_PROMPT.md) の**補足**であり、置き換えではない。

---

あなたは、探索アルゴリズム、組合せ最適化、Multi-Agent Path Finding（MAPF）、
Multi-Agent Pickup and Delivery（MAPD）を専門とする実装担当者です。

作業対象：`/home/hirayama/study-mapf`
公開 URL：`https://abigworld1.github.io/study-mapf/`

**まず [CODEX_PROMPT.md](CODEX_PROMPT.md) を最初から最後まで読んでください。**
そこに書かれた共通ルール（禁止事項、ライセンス、SolverResult / SolverEvent の型、
完成度ラベル、テスト方針、品質ゲート、実装報告の形式）はすべてそのまま適用されます。

# 今回の対象

```text
TARGET_ALGORITHMS:
- lns-pbs    （LNS-PBS。well-formed で完全）
- lns-wpbs   （LNS-wPBS。完全性の保証なし）
- rmca       （RMCA。容量制約つき MAPD）
```

`regret-insertion` も `rmca-ral-2021` 由来の別 id として登録されています。
扱いは落とし穴 4 を読んでから相談してください。

# 使えるものが多いバッチです

Batch 1〜8 で積んだものがほぼそのまま効きます。**作り直さないでください。**

| 要るもの                       | すでにあるもの                                                           |
| ------------------------------ | ------------------------------------------------------------------------ |
| MAPD の実行ループ              | `runMapdLoop` / `MapdStrategy`（`src/solvers/mapd/loop.ts`）             |
| well-formed 判定               | `checkWellFormed`（`src/lib/model/mapd.ts`）                             |
| PBS                            | `src/solvers/pbs/pbs.ts`（Batch 3）                                      |
| windowed 再計画                | RHCR（`src/solvers/lns/solvers.ts`、Batch 6）。**LNS-wPBS はこれを使う** |
| LNS の骨格                     | MAPF-LNS（同上）                                                         |
| 経由地つき単一エージェント探索 | MLA\*（`src/solvers/mapd/mla-star.ts`、Batch 8）                         |
| 比較対象                       | CENTRAL / HBH+MLA\*（Batch 8）。**論文が実際に比較している相手**         |
| 目的関数の明示                 | `SolverResult.objective`                                                 |
| 入力形状での絞り込み           | `MapfSolver.canSolve`                                                    |

**着手前に必ず読むこと：**
[`docs/notes/implementation/mapd-loop.md`](docs/notes/implementation/mapd-loop.md)

# Batch 9 固有の落とし穴

## 落とし穴 1（最重要）モデルを 3 つ拡張する必要があります

いまの MAPD モデルは「1 エージェントが 1 タスクを持ち、タスクは pickup と
delivery をちょうど 1 つずつ持つ」です。Batch 9 の 3 手法はどれもそこを超えます。

| 拡張                                                 | 誰が要求するか            | 根拠                    |
| ---------------------------------------------------- | ------------------------- | ----------------------- |
| エージェントが**複数タスクを同時に運ぶ**（容量制約） | RMCA                      | `rmca-ral-2021` p.1–3   |
| エージェントに**タスクの列**を割り当てる             | LNS-PBS / LNS-wPBS / RMCA | `mg-mapd-iros-2022` p.1 |
| タスクが**任意個の goal を持つ**（MG-MAPD）          | LNS-PBS / LNS-wPBS        | 同 p.1                  |

RMCA 論文 p.2 は自分の位置づけをこう書いています。

> all other work in the literature assume **the capacity of each agent is
> always 1** which implies immediate delivery is required after every pickup

つまり**容量 1 は Batch 8 までの前提**で、RMCA はそれを外すのが売りです。

**`MapdStepInput.carrying` は 1 エージェント 1 タスクの形（`Map<AgentId, {task, pickedUp}>`）
です。ここを変えないと RMCA は載りません。**

守ること：

- **`runMapdLoop` の 1 ステップの順序を変えないこと。** 変えると service time が
  1 ずれ、Batch 8 までの手法と比較できなくなります。
- 拡張は**後方互換で**行うこと。容量 1・単一 goal のときは既存 4 手法
  （`mapd-greedy` / TP / TPTS / CENTRAL）の結果が**1 歩も変わらない**こと。
  `tests/unit/mapd.test.ts` と `tests/unit/batch8-mapd.test.ts` が通ったままであること。
- **拡張案を実装前に報告してください。** ループの中核なので、
  勝手に大きく変えられると Batch 8 までが巻き添えになります。

## 落とし穴 2：LNS-PBS と LNS-wPBS は「保証あり」と「保証なし」の対です

`mg-mapd-iros-2022` p.1 abstract：

> **LNS-PBS is complete for well-formed MAPD instances** …
> **LNS-wPBS provides no completeness guarantee** but is empirically more
> efficient and stable than LNS-PBS. It scales to thousands of agents …

p.5 **Theorem 1**：

> Given a well-formed MG-MAPD instance with a finite number of tasks,
> LNS-PBS is guaranteed to find collision-free paths in finite time that
> allow each agent to execute all tasks assigned to it.

**CENTRAL のときと同じ構図です。** 速いほう（LNS-wPBS）に保証が無い。
Batch 8 で CENTRAL に置いた注意書きと同じ扱いをしてください。

- `lns-wpbs` の `guarantees.complete` に `true` を書かない
- 比較表・解説で「速い＝優れている」と読ませない
- LNS-wPBS が良い数値を出したとき、それが保証の裏付けを持たないと分かるようにする

なお LNS-PBS の完全性は「reserving dummy paths」（同 p.1、出典は TP の論文）に
依存します。PBS 自体は不完全なので、**PBS が完全になったわけではありません。**
ここを混ぜないでください。

## 落とし穴 3：RMCA の目的関数は service time ではありません

`rmca-ral-2021` p.3：

> the objective to minimize the **total travel delay (TTD)** for the robots to
> transport all the tasks while avoiding collisions

Batch 8 までの MAPD 手法は service time（`mapd-tp-tpts-central-2017` p.2 §3.1）で
評価しています。**TTD と service time は別の量です。**

- RMCA の `objective` に TTD を入れられるよう、`SolverResult.objective` の
  取りうる値を増やす必要があるかもしれません。増やす場合は報告してください。
- **RMCA と TP / TPTS / CENTRAL / LNS-PBS の数値を直接比較しないこと。**
  比較表に並べるなら、最小化している量が違うことを必ず添えてください。
- 画面には service time も出ます。RMCA を実行したとき「表示されている
  service time が最適化対象だ」と読まれないようにしてください。

これは LaCAM\* の sum-of-loss、CBM と CBS-TA の makespan / SOC、CENTRAL の
service time に続く 4 例目です。この案件で一番繰り返している間違いです。

## 落とし穴 4：`regret-insertion` の扱いは判断が要ります

`rmca-ral-2021` は RMCA 本体のほかに regret ベースの挿入ヒューリスティクスを
提案していて、`algorithms.yaml` には `regret-insertion` という別 id があります。

Batch 7 の Hungarian / Gale-Shapley、Batch 8 の MLA\* / HBH と同じで、
**単体の Solver ではなく部品**の可能性が高いです。その場合は
`implementation_status: library` にしてください（Batch 7 で追加した状態です）。

**勝手に決めず、着手前に案を報告してください。**

## 落とし穴 5：論文が比較している相手はもう実装済みです

`mg-mapd-iros-2022` は LNS-PBS を **CENTRAL** と、LNS-wPBS を **HBH+MLA\*** と
比較しています。どちらも Batch 8 で実装済みです。

**同じプリセットで並べて実測し、論文の傾向と一致するか / しないかを報告してください。**
一致しなくても構いません（盤面が小さいので当然ずれます）。
**一致しないことを隠したり、一致するように盤面を選んだりしないでください。**

RMCA は TPTS と比較されています（同 p.1）。TPTS も実装済みです。
ただし落とし穴 3 のとおり目的関数が違うので、**数値の優劣として書かないこと。**

# 確認済みの引用アンカー

こちらで `pdftotext` で確認済みです。**それでも自分で再確認してください。**

| 内容                                                             | ページ |
| ---------------------------------------------------------------- | ------ |
| RMCA: 「carry multiple tasks」（abstract）                       | p.1    |
| RMCA: 「the capacity of each agent is always 1」（他手法の前提） | p.2    |
| RMCA: TTD の定義、loading capacity                               | p.3    |
| MG: LNS-PBS は complete / LNS-wPBS は no guarantee（abstract）   | p.1    |
| MG: Multi-Goal MAPD の定義                                       | p.1–3  |
| MG: **Theorem 1**（LNS-PBS の完全性）                            | p.5 §D |
| MG: dummy path による完全性の根拠                                | p.1    |

ページ番号は必ず `pdftotext -f N -l N <pdf> - | grep ...` で裏を取ってから書いてください。
Batch 6 では 3 件の取り違えがありました。

# ライセンス

- `rmca-ral-2021` は **CC BY-NC-ND 4.0 で再配布可**（`papers.yaml` の
  `redistribution.status: allowed`）。ただし**改変不可**なので、
  PDF をそのまま置く以外のことはしないこと。現状の運用を変える必要はありません。
- `mg-mapd-iros-2022` は arXiv の link-only。
- 両手法とも公開実装は未特定です。見つけた場合は `repositories.yaml` へ
  ライセンスを確認してから登録してください。**確認できないものは登録しない。**

# 実装する順番（推奨）

1. **モデル拡張**（落とし穴 1）— 相談してから。後方互換を最優先。
2. **lns-pbs** — LNS で割当、PBS で経路。完全性は dummy path に依存する。
3. **lns-wpbs** — LNS-PBS の windowed 版。RHCR の windowed 再計画を使う。
4. **rmca** — 容量制約。marginal-cost 割当 + LNS 改善、経路は優先順位付き計画。
5. **regret-insertion** — 落とし穴 4 の相談後。

# 着手前に報告してほしいこと

1. 落とし穴 1：モデル拡張の設計（容量・タスク列・多目的地の 3 つ）
2. 落とし穴 3：TTD を `objective` にどう入れるか
3. 落とし穴 4：`regret-insertion` の扱い

# 品質ゲート

CODEX_PROMPT.md の品質ゲートをそのまま守ってください。加えて Batch 9 では：

- `npm run sources:validate` が `errors=0`
- **既存 4 手法（`mapd-greedy` / TP / TPTS / CENTRAL）の結果が 1 歩も変わらない。**
  `tests/unit/mapd.test.ts` と `tests/unit/batch8-mapd.test.ts` が無修正で通ること
- `runMapdLoop` の 1 ステップの順序を変えていない
- **`lns-wpbs` の `guarantees.complete` が `true` でない**
- 全 MAPD プリセット × 全 MAPD 手法で、`solved` のとき衝突 0
- 容量制約つきのプリセットを 1 つ以上足し、容量 1 と 2 以上で結果が変わることを示す
- 多目的地タスクのプリセットを 1 つ以上足す
- RMCA の `objective` が service time になっていない

# 実装報告

CODEX_PROMPT.md の形式で。加えて次を明記してください。

- モデル拡張で何を変えたか。既存 4 手法の出力が変わっていないことの確認方法
- 各手法が最小化した量（TTD / service time / それ以外）
- 論文が比較している相手（CENTRAL、HBH+MLA\*、TPTS）との実測値。
  **論文の傾向と一致したか、しなかったか**
- 落とし穴 4 について採った設計
- 確定できなかった保証と、その理由
