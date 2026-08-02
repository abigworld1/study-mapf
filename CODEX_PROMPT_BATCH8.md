# Codex 用プロンプト — Batch 8（MAPD）

> このファイルは Codex へそのまま貼るためのもの。`---` 以下を全部コピーして使う。
> [CODEX_PROMPT.md](CODEX_PROMPT.md) の**補足**であり、置き換えではない。

---

あなたは、探索アルゴリズム、Multi-Agent Path Finding（MAPF）、
Multi-Agent Pickup and Delivery（MAPD）を専門とする実装担当者です。

作業対象：`/home/hirayama/study-mapf`
公開 URL：`https://abigworld1.github.io/study-mapf/`

**まず [CODEX_PROMPT.md](CODEX_PROMPT.md) を最初から最後まで読んでください。**
そこに書かれた共通ルール（禁止事項、ライセンス、SolverResult / SolverEvent の型、
完成度ラベル、テスト方針、品質ゲート、実装報告の形式）はすべてそのまま適用されます。
このファイルは Batch 8 に固有の事情だけを足すものです。

# 今回の対象

```text
TARGET_ALGORITHMS:
- mla-star       （Multi-Label A*）
- token-passing  （TP）
- tpts           （TPTS: Token Passing with Task Swaps）
- central        （CENTRAL）
- hbh            （HBH: Hungarian-Based Heuristic。着手前に扱いを相談すること）
```

# 前回までとの一番の違い：MAPD の実行ループはもう出来ている

**着手前に必ず読むこと：**
[`docs/notes/implementation/mapd-loop.md`](docs/notes/implementation/mapd-loop.md)
（特に末尾の「Batch 8 への引き継ぎ」節）

用意済みのもの：

| ある物                                     | 場所                                        |
| ------------------------------------------ | ------------------------------------------- |
| 実行ループ `runMapdLoop`                   | `src/solvers/mapd/loop.ts`                  |
| 戦略インタフェース `MapdStrategy`          | 同上                                        |
| endpoint の導出（V_ep / V_tsk / non-task） | `src/lib/model/mapd.ts` の `endpointsOf`    |
| well-formed 判定（Definition 1）           | 同 `checkWellFormed`                        |
| `Scenario.parkingEndpoints`                | `src/lib/model/types.ts`                    |
| MAPD プリセット 2 つ                       | `mapd-well-formed` / `mapd-not-well-formed` |
| service time / throughput / 未処理の表示   | シミュレータの指標表                        |
| well-formed 判定の画面表示                 | シミュレータの MAPD セクション              |
| non-task endpoint の描画                   | `src/lib/render/renderer.ts`（破線の円）    |
| 形状述語 `canSolve`                        | `MapfSolver`。`Scenario.kind` と形状で絞る  |
| 対照用ベースライン `mapd-greedy`           | `src/solvers/mapd/greedy.ts`                |

**TP / TPTS / CENTRAL は `MapdStrategy` を実装するだけで載ります。
`runMapdLoop` を書き換えないでください。**
書き換えが要ると判断した場合は、実装前に理由を報告してください。

`MapdStepInput.endpoints.nonTask` に退避先の候補が入っています。
TP の Path2 相当はそこから選べます。

# Batch 8 固有の落とし穴

## 落とし穴 1（最重要）：CENTRAL は「一番良い数値を出すが保証が無い」手法です

論文はこう書いています。

- p.1 abstract：「we compare them against a centralized strawman MAPD algorithm
  **without this guarantee**」
- p.5 §6：「We want CENTRAL to be reasonably efficient and effective but
  **do not require that it is optimally effective or even solves all
  well-formed MAPD instances**」
- p.7-8 結論：「The MAPD algorithms **in increasing order of their makespans and
  service times** tend to be: **CENTRAL, TPTS, and TP**」

つまり **CENTRAL は service time が一番小さいのに、well-formed インスタンスを
解ける保証すら持ちません。** TP と TPTS は Theorem 3 / Theorem 5 で保証を持ちます。

守ること：

1. 比較表や解説で「service time が小さい ＝ 優れた手法」と読ませないこと。
   数値の順序と保証の有無が逆向きであることを明示してください。
2. CENTRAL の `guarantees` に `true` を書かないこと。論文が明示的に
   「保証しない」と述べています。
3. シミュレータで CENTRAL が良い数値を出したとき、それが保証の裏付けを
   持たないことが分かるようにすること。

これはこの案件で繰り返し問題になってきた「数値と保証の混同」の一番きつい例です。

## 落とし穴 2：TP と TPTS の保証は well-formed 前提。実行ループが既に警告を出します

- p.4 **Theorem 3**：「All well-formed MAPD instances are solvable, and TP solves them.」
- p.5 **Theorem 5**：「TPTS solves all well-formed MAPD instances.」
- p.2：well-formed は**十分条件**であって必要条件ではない
  （「We now provide a sufficient condition that makes MAPD instances solvable」）

`runMapdLoop` が well-formed でない入力に対して自動で警告を出します。
**同じ内容の警告を戦略側から二重に出さないでください。**
戦略が足すべきなのは、その手法固有の簡略化についての警告だけです。

`mapd-not-well-formed` プリセットで TP を実行したとき、
「TP が悪い」ではなく「保証の対象外の入力である」と読める状態を保ってください。

## 落とし穴 3：TP は token を明示的に持つべきです

現在のベースライン `mapd-greedy` は token ではなく予約表で代用しています。
**それを真似しないでください。**

論文 p.2-3 の token は「全エージェントの経路とタスク集合」で、
Path1 / Path2 はそれを見て衝突を避けます。token を 1 体ずつ回すのが TP の
本体なので、そこを予約表に潰すと手法の説明が成り立ちません。
`update-token` イベントは既に `SolverEvent` にあります。

TPTS（p.4 Algorithm 2）は TP と同じ main loop と Path1 / Path2 を使い、
`GetTask` だけが違います。**共通部分を切り出して重複実装を避けてください。**

## 落とし穴 4：MLA\* に定理は見当たりません。保証を作らないこと

`mla-star-icaps-2019` を通し読みしましたが、MLA\* の完全性・最適性を述べた
定理・補題は見つけられませんでした。**見つからなければ `unknown` のままにしてください。**
「A\* の変種だから最適だろう」は推測です（SOURCE_POLICY.md 第 7 条）。

見つかった場合はページと原文を `guarantee_evidence` に入れてください。

MLA\* は pickup → delivery のように「途中で必ず経由する地点」がある単一
エージェント探索で、ラベル（未 pickup / pickup 済み）で状態を分けます。
現在のベースラインはこれを 2 回の探索に分けており、pickup での待ち時間を
最適化できていません。**MLA\* を先に実装すると TP の低レベルがきれいになります。**

## 落とし穴 5：`token-passing` のマニフェスト注記が古くなっています

`algorithms.yaml` の `token-passing` にこう書いてあります。

> アブストラクトに TP の保証に言及する記述があるが、**抽出が途中で切れており
> 保証の内容と前提を確定できなかった**。… PDF 取得後に必ず確定すること。

**もう確定できます。** p.4 Theorem 3 に明記されています。
`complete` を `conditional` のままにするか `true` にするかは、
「well-formed に限る」という前提をどう表現するかの判断なので、
根拠つきで決めて `guarantee_evidence` を書き直してください。
`tpts` / `central` / `mla-star` / `hbh` の `null` も同様に埋めること。
埋められないものは、なぜ埋められないかを notes に書いてください。

## 落とし穴 6：HBH の扱いは判断が要ります

`hbh` は `mla-star-icaps-2019` が提案する**中央集権のタスク割当ヒューリスティクス**で、
MLA\* とは別物です（同 Algorithm 2）。論文の実験は `TP+MLA*` や `HBH+MLA*` と
いう組合せで評価しています。

論点：

- HBH 単体は MAPD Solver として成立するのか、それとも `MapdStrategy` の
  一部（割当部分）なのか
- `TP+MLA*` や `HBH+MLA*` を別の `algorithm-id` にするのか、
  既存 id のオプションにするのか
- HBH はハンガリアン法を使う（Batch 7 で `src/lib/assignment/hungarian.ts` に
  実装済み）。それを呼ぶこと。再実装しないこと

**勝手に決めず、着手前に案を報告してください。**

# 確認済みの引用アンカー

こちらで `pdftotext` で確認済みです。**それでも自分で再確認してください。**
Batch 6 ではページの取り違えが 3 件ありました。

| 内容                                                        | ページ     |
| ----------------------------------------------------------- | ---------- |
| MAPD 問題定義 / service time の定義                         | p.2 §3.1   |
| well-formed の定義（Definition 1）、endpoint の定義         | p.2 §3.2   |
| TP の Algorithm 1、Property 1                               | p.3        |
| TP の Property 2、**Theorem 3**（TP は well-formed を解く） | p.4        |
| TPTS の Algorithm 2                                         | p.4        |
| TPTS の Property 4、**Theorem 5**（TPTS も解く）            | p.5        |
| CENTRAL（§6。保証を要求しないと明記）                       | p.5        |
| 手法の順序（service time は CENTRAL < TPTS < TP）           | p.7-8 結論 |

MLA\* / HBH（`mla-star-icaps-2019`）はページ確認をしていません。自分で取ってください。
HBH の Algorithm 2 は marker.md の 95-120 行あたりにあります。

ページ番号は必ず `pdftotext -f N -l N <pdf> - | grep ...` で裏を取ってから書いてください。

# 実装する順番（推奨）

1. **mla-star** — 単一エージェント探索。TP / TPTS / HBH の低レベルになる。
   ラベル付き状態空間（未 pickup / pickup 済み）で実装する。
2. **token-passing** — `MapdStrategy` として実装。token を明示的に持つ。
   Path1（p.3）と Path2（p.4）を分けて書く。
3. **tpts** — TP と main loop / Path1 / Path2 を共有し、`GetTask` だけ差し替える。
4. **central** — 比較対象。保証が無いことを外さない。
5. **hbh** — 落とし穴 6 の相談後。ハンガリアン法は Batch 7 の実装を使う。

# 着手前に報告してほしいこと

1. 落とし穴 6：HBH と `TP+MLA*` / `HBH+MLA*` をどう扱うか
2. `runMapdLoop` の書き換えが要ると判断した場合、その理由

# 品質ゲート

CODEX_PROMPT.md の品質ゲートをそのまま守ってください。加えて Batch 8 では：

- `npm run sources:validate` が `errors=0`
- `token-passing` / `tpts` / `central` / `mla-star` / `hbh` の
  `guarantee_evidence` が埋まっている（埋められないものは理由を notes に）
- **CENTRAL の `guarantees` に `true` が入っていない**
- `mapd-well-formed` プリセットを TP / TPTS / CENTRAL がいずれも処理しきる
- `mapd-not-well-formed` で TP / TPTS が失敗した場合、
  well-formed 前提であることが警告で伝わる（ループが自動で出す。二重に出さない）
- `runMapdLoop` を書き換えていない（書き換えた場合は理由を報告）
- 既存の `mapd-greedy` と `tests/unit/mapd.test.ts` が壊れていない
- service time が releaseTime 起点のまま（ループの 1 ステップ順序を変えない）

# 実装報告

CODEX_PROMPT.md の形式で。加えて次を明記してください。

- 各手法の service time / throughput と、**保証の有無**（数値の順序と
  保証の順序が逆向きであることに触れること）
- token を明示的に持ったか、予約表で代用したか
- MLA\* の定理を見つけられたか。見つからなければその旨
- 落とし穴 6 について最終的に採った設計
- 確定できなかった保証と、その理由
