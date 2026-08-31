# Codex 用プロンプト — Batch 10（CBS の強化：DS / CBSH / MA-CBS）

> このファイルは Codex へそのまま貼るためのもの。`---` 以下を全部コピーして使う。
> [CODEX_PROMPT.md](CODEX_PROMPT.md) の**補足**であり、置き換えではない。

---

あなたは、探索アルゴリズム、組合せ最適化、Multi-Agent Path Finding（MAPF）を
専門とする実装担当者です。

作業対象：`/home/hirayama/study-mapf`
公開 URL：`https://abigworld1.github.io/study-mapf/`

**まず [CODEX_PROMPT.md](CODEX_PROMPT.md) を最初から最後まで読んでください。**
そこに書かれた共通ルール（禁止事項、ライセンス、SolverResult / SolverEvent の型、
完成度ラベル、テスト方針、品質ゲート、実装報告の形式）はすべてそのまま適用されます。

# 今回の対象

```text
TARGET_ALGORITHMS:
- disjoint-splitting  （DS。正制約と負制約の対で分岐する）
- cbsh                （CBSH。高レベルに許容ヒューリスティクスを入れる）
- ma-cbs              （MA-CBS。衝突が閾値を超えた対をメタエージェントへ併合）
```

3 つとも**既存の CBS コアに載せる**ものです。新しい Solver ファミリを
一から作る話ではありません。土台は `src/solvers/cbs/core.ts`（717 行）です。

# 使えるものが多いバッチです

Batch 1〜9 で積んだものがそのまま効きます。**作り直さないでください。**

| 要るもの                   | すでにあるもの                                                          |
| -------------------------- | ----------------------------------------------------------------------- |
| CBS の高レベル探索         | `src/solvers/cbs/core.ts`。CBS / ICBS / BCBS / ECBS / EECBS が共有      |
| 低レベル（制約つき探索）   | `src/solvers/cbs/low-level.ts`                                          |
| cardinal / semi / non 分類 | 実装済み。`classify-conflict` イベントも出る                            |
| bypass（BP）               | 実装済み。`bypass` イベントも出る                                       |
| 制約の型に `positive`      | `VertexConstraint.positive` / `EdgeConstraint.positive`（`types.ts`）   |
| 参照実装（最適値の照合）   | `jointStateOptimalSumOfCosts`（`src/solvers/reference/joint-state.ts`） |
| 共通不変条件のテスト       | `tests/unit/solver-invariants.test.ts`                                  |
| 入力形状での絞り込み       | `MapfSolver.canSolve`                                                   |

★ **PC（prioritizing conflicts）と BP（bypass）は実装済みです。**
`prioritizing-conflicts` と `cbs-bypass` はマニフェスト上の別 id ですが、
中身は ICBS の一部としてもう動いています。作らないでください。

# Batch 10 固有の落とし穴

## 落とし穴 1（最重要）DS は低レベルにも手を入れないと成立しません

`Constraint.positive` は型にはありますが、**低レベルは今これを無視しています。**

```text
src/solvers/cbs/low-level.ts:194  !constraint.positive && ...
src/solvers/cbs/low-level.ts:205  !constraint.positive && ...
src/solvers/cbs/low-level.ts:215  ... || constraint.positive || ...
```

負制約（「そこを通るな」）だけを見て、正制約は素通りしています。
DS の片方の枝は「時刻 t にセル v を**必ず通れ**」なので、低レベルが
正制約を強制できないと、DS は「片方の枝が制約なしで開く」だけになり、
**完全性も最適性も壊れます**（同じ衝突が無限に再発しうる）。

正制約の意味を、負制約との相互作用も含めて実装してください。

- 対象 agent は時刻 t に v に**居なければならない**。
- **他の agent は時刻 t に v に居てはならない**（正制約は他 agent への
  負制約を含意する）。ここを落とすと解が壊れます。
- 辺の正制約も同様（対象 agent はその辺を通る、他 agent はその辺を使えない）。

## 落とし穴 2：DS の分岐は「どちらの子も同じ解集合を覆う」ことが肝です

一次資料の言い方をそのまま置きます。

> disjoint-splitting-icaps-2019 p.3
> "Clearly, disjoint splitting is complete since one of the two constraints
> must hold for any candidate conflict-free plan in the parent CT node"

> cbsh2-rtc-aij-2021 p.6 Theorem 2
> "Using two sets of mutually disjunctive constraints to split a CT node
> preserves the completeness and optimality of CBS."

★ 分岐の 2 枝が場合を尽くしているか、コメントで説明してください。
既存の following 分岐（`constraintsFor`）に同じ形の説明を書いてあるので、
書き方はそれに合わせてください。

★ **どの agent に正制約を与えるかの選び方**は実装の自由度です。
論文がどう決めているかを確認し、確認できた範囲を実装、確認できない範囲は
「こう決めた」と `implementationNote` に書いてください。**推測を論文の主張と
して書かないでください。**

## 落とし穴 3：CBSH の h は「許容」でなければ意味がありません

一次資料（cbsh-icaps-2018）：

- p.1「we introduce different admissible heuristics for CBS by aggregating
  cardinal conflicts among agents」
- p.2 conflict graph `G_CF = (V_CF, E_CF)` の定義。cardinal conflict に
  関与する agent が頂点、cardinal conflict が辺。
- p.2「an h-value of one is admissible for node N because the cost of any of
  its descendants in the CT with a conflict-free solution is at least
  N.cost + 1」
- p.3 §3.1 maximum matching（ICBS-h2）、§3.2 **Minimum Vertex Cover** of the
  conflict graph を許容 h として使う。最小頂点被覆は NP-hard（同 p.3）。

★ **落とし穴はここです（同 p.4）。**

> "Admissible h-values of such non-goal nodes have to be zero in case they are
> connected to goal nodes via one or more zero-cost edges."

zero-cost 辺で goal node と繋がっている non-goal node の h は 0 でなければ
許容になりません。BP（bypass）が同 cost の子へ移る実装になっているので、
**この条件はこのリポジトリで実際に起きます**。ここを外すと最適解を
取りこぼし、しかも「最適」と表示します。既存の最適性テスト
（`tests/unit/solver-invariants.test.ts` の「最適を主張する手法は参照実装と
同じ sum of costs を返す」）に `cbsh` を足して落ちないことを確認してください。

★ 最小頂点被覆は NP-hard なので、教材用に何を使ったか（厳密な小規模探索か、
近似か、maximum matching か）を `implementationNote` に明記してください。
**近似を使うなら h は許容でなくなる可能性があるので、その場合は
`optimal` を主張しないでください。**

## 落とし穴 4：MA-CBS は「B の連続体」として見せると説明になります

一次資料：

- ma-cbs-socs-2012 p.2「When the number of conflicts exceed B, the conflicting
  agents are merged into a meta-agent and then treated as a joint composite
  agent by the low-level solver.」
- 同 p.3 `should-merge()` は素の CBS では常に false を返す（＝素の CBS は
  MA-CBS の B=∞ の場合）。
- 同 p.5 meta-constraint `(x, v, t)` の定義と、併合した agent の制約の
  引き継ぎ方。
- 同 p.6「MA-CBS(0) is equivalent to A\*+ID」。
- cbs-aij-2015 p.19「This constraint-merging mechanism must be designed such
  that MA-CBS still returns an optimal solution.」

★ B=0 で結合探索、B=∞ で素の CBS という連続体になるので、**B を UI から
動かせるように**してください（`extra.mergeThreshold`）。LNS-wPBS の
「時間窓 w」と同じ扱いです（`src/components/simulator/Simulator.tsx` の
`wpbsWindow` が前例）。

★ メタエージェントの低レベルは結合探索になります。**ブラウザで動く教材**
なので、併合サイズの上限と、上限に達したときの正直な打ち切り（警告つき）を
必ず入れてください。無言で固まるのが最悪です。

## 落とし穴 5：保証はもうマニフェストに書いてあります

3 つとも `docs/sources/algorithms.yaml` の `guarantees` と
`guarantee_evidence` が**一次資料で確定済み**です（2026-08-31 に確認）。

```text
disjoint-splitting  complete: conditional / optimal: true
cbsh                complete: unknown    / optimal: unknown   ← 未確定のまま
ma-cbs              complete: conditional / optimal: true
```

★ `complete: conditional` は「CBS 自身の条件を引き継ぐ」という意味です。
定理が "preserves the completeness and optimality of **CBS**" の形なので、
CBS が持たない無条件の完全性を主張してはいけません。

★ `cbsh` は未確定です。実装のついでに PDF 本文を確認し、
完全性・最適性を述べる定理・補題が**見つかった場合だけ**マニフェストを
更新してください。見つからなければ `unknown` のままにしてください。
**「許容ヒューリスティクスだから最適に決まっている」で埋めないでください。**
これは SOURCE_POLICY.md の第 7・8 条です。

# 確認済みの引用アンカー

以下はこちらで PDF 本文を確認済みです。そのまま使えます。
**これ以外のページ番号を書くときは、必ず自分で PDF を開いて確認してください。**

| 出典                          | ページ | 内容                                                 |
| ----------------------------- | ------ | ---------------------------------------------------- |
| disjoint-splitting-icaps-2019 | p.2    | CBS が 2 分岐で最適性を担保する説明                  |
| disjoint-splitting-icaps-2019 | p.3    | disjoint splitting の完全性の説明                    |
| cbsh2-rtc-aij-2021            | p.6    | Theorem 2（互いに素な制約集合での分割が保証を保つ）  |
| cbsh-icaps-2018               | p.1    | cardinal conflict の集約による許容ヒューリスティクス |
| cbsh-icaps-2018               | p.2    | conflict graph の定義、h=1 の許容性                  |
| cbsh-icaps-2018               | p.3    | §3.1 maximum matching / §3.2 minimum vertex cover    |
| cbsh-icaps-2018               | p.4    | zero-cost 辺で goal と繋がる node の h は 0          |
| ma-cbs-socs-2012              | p.2    | 閾値 B とメタエージェント併合                        |
| ma-cbs-socs-2012              | p.3    | `should-merge()`。素の CBS では常に false            |
| ma-cbs-socs-2012              | p.5    | meta-constraint `(x, v, t)` と制約の引き継ぎ         |
| ma-cbs-socs-2012              | p.6    | MA-CBS(0) ≡ A\*+ID                                   |
| cbs-aij-2015                  | p.19   | 制約併合は最適性を保つよう設計すること               |

# ライセンス

公開実装のコードをコピーしないでください。論文と自分の実装だけで書いてください。
参照した公開実装がある場合は、`.references/` に置いて読むだけにし、
何をどう参照したかを報告に書いてください（`.references/` はコミットしない）。

# 実装する順番（推奨）

1. **低レベルの正制約**（落とし穴 1）。ここが土台で、DS はこれ無しでは成立しません。
   単体テストを先に書いてください。「正制約を与えた agent がその時刻にそのセルに
   居る」「他 agent がそこへ入れない」の 2 点。
2. **disjoint-splitting**。分岐が場合を尽くすことをコメントで説明し、
   既存の最適性テストに追加して参照実装と一致することを確認。
3. **cbsh**。conflict graph → 許容 h。**p.4 の zero-cost 辺の条件を必ず入れる。**
4. **ma-cbs**。B を `extra.mergeThreshold` で受け、UI から動かせるようにする。
   併合サイズの上限と打ち切り警告を入れる。

# 着手前に報告してほしいこと

実装に入る前に、次を短く報告してください。

- 低レベルの正制約をどこにどう入れるか（既存の負制約の判定との関係）
- DS でどの agent に正制約を与えるかの決め方と、その根拠（論文のどこか、
  それとも実装上の選択か）
- CBSH の最小頂点被覆をどう計算するか。近似なら `optimal` をどう扱うか
- MA-CBS の併合サイズ上限をいくつにするか、超えたときどう返すか

# 品質ゲート

[CODEX_PROMPT.md](CODEX_PROMPT.md) の品質ゲートをすべて通してください。
このバッチで特に効くのは次の 2 つです。

- `tests/unit/solver-invariants.test.ts` の「最適を主張する手法は参照実装と
  同じ sum of costs を返す」に **`cbsh` と `disjoint-splitting` を追加**する。
  最適を主張するなら、参照実装と 1 手も違ってはいけません。
- 同ファイルの「プリセットと Solver の噛み合わせ」は探索上限 100 / 1000 で
  一周します。**打ち切ったときに有効な解を持っていれば `solved` を名乗ること**、
  **候補に出した Solver が `invalid-scenario` で落ちないこと**を見ています。

★ **WSL のメモリが厳しいことがあります。** `npm test` を一度に流すと
OOM で落ちることがあったので、落ちたらファイル単位で分割して流してください。

# 実装報告

[CODEX_PROMPT.md](CODEX_PROMPT.md) の形式で報告してください。加えて次を必ず含めること。

- 低レベルの正制約をどう実装したか。**他 agent への含意**を入れたか
- DS の 2 枝が場合を尽くすことの説明
- CBSH の h の計算方法と、p.4 の zero-cost 辺の条件をどう扱ったか
- MA-CBS の B の既定値と、UI からの動かし方
- マニフェストを更新した場合は、**どの PDF の何ページの何を読んだか**
- 実装しなかった論文の機能（あれば全部）
