# Codex 用プロンプト — Batch 11（CBS の対称性推論：矩形 / 回廊 / 目標）

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
- rectangle-reasoning  （矩形対称性。barrier constraint で解消）
- target-reasoning     （目標対称性。length constraint で解消）
- corridor-reasoning   （回廊対称性。range constraint で解消）
```

出典はすべて `cbsh2-rtc-aij-2021`（全 66 ページ）です。3 つとも
**既存の CBS 共通コアに載せる**もので、新しい Solver ファミリを作る話ではありません。
土台は `src/solvers/cbs/core.ts` と、Batch 10 で入った
`src/solvers/cbs/constraint-semantics.ts` です。

# 使えるものが多いバッチです

Batch 1〜10 で積んだものがそのまま効きます。**作り直さないでください。**

| 要るもの                     | すでにあるもの                                                          |
| ---------------------------- | ----------------------------------------------------------------------- |
| CBS の高レベル探索           | `src/solvers/cbs/core.ts`。CBS / ICBS / CBSH / DS / MA-CBS が共有       |
| 低レベル（制約つき探索）     | `src/solvers/cbs/low-level.ts`                                          |
| 正制約・負制約の意味論       | `src/solvers/cbs/constraint-semantics.ts`（Batch 10）                   |
| cardinal / semi / non 分類   | 実装済み。`classify-conflict` イベントも出る                            |
| 互いに素な制約での分岐（DS） | Batch 10 で実装済み。今回の 3 つも同じ枠組みに乗る                      |
| 参照実装（最適値の照合）     | `jointStateOptimalSumOfCosts`（`src/solvers/reference/joint-state.ts`） |
| MDD の構築                   | `src/solvers/joint/icts.ts` の `buildMdd`（★ 落とし穴 4 を読むこと）    |

# Batch 11 固有の落とし穴

## 落とし穴 1（最重要）分岐 API が「子 1 つにつき制約 1 個」のままです

今の `constraintsFor(conflict)` は **`Constraint` を 2 個返す**（子ごとに 1 個）
作りになっています。

```text
src/solvers/cbs/core.ts:939  function constraintsFor(conflict: Conflict): readonly Constraint[]
src/solvers/cbs/core.ts:492  constraints: [...parent.constraints, ...constraints]
```

しかし今回の 3 つはいずれも **子 1 つにつき制約が複数** です。

- barrier constraint は**頂点制約の集合**です。同 p.15 の定義:
  「B(a_i, R_i, R_g) = {⟨a_i, (x,y), t⟩ | ((x,y),t) ∈ R_i…R_g}, which is a set of
  vertex constraints that prohibits agent a_i from occupying any node along its
  exit border R_i R_g」
- range constraint は**時刻の範囲**にわたる禁止です。
- length constraint は頂点制約でも辺制約でもありません（落とし穴 3）。

★ **まず分岐 API を「子ごとに制約の集合」へ広げてください。** ここを直さずに
無理やり 1 個へ潰すと、対称性が壊れて最適性を失います。既存の
vertex / edge-swap / following / DS の分岐は「集合の要素数が 1 または 2」の
特別な場合として、**振る舞いを変えずに**移行できるはずです。移行後に
既存の最適性テストが通ることを必ず確認してください。

## 落とし穴 2：分岐が「場合を尽くす」ことの根拠を書くこと

今回の 3 つは、いずれも同じ定理の系として保証されます。

> cbsh2-rtc-aij-2021 p.6 Definition 2 (Mutually Disjunctive)
> 「Two constraints for two agents a_i and a_j are mutually disjunctive iff any
> pair of conflict-free paths of a_i and a_j satisfies at least one of the two
> constraints」

> 同 p.6 Theorem 2
> 「Using two sets of mutually disjunctive constraints to split a CT node
> preserves the completeness and optimality of CBS.」

★ **「保つ対象は CBS の保証」です。** マニフェストの `complete` は 3 つとも
`conditional`（CBS と同じ条件を引き継ぐ）で確定済みです。`true` にしないでください。
CBS 自身が持たない無条件の完全性を主張することになります。

既存の following 分岐（`constraintsFor`）に「2 枝が場合を尽くす」ことの説明を
コメントで書いてあります。今回も同じ形で、**なぜ mutually disjunctive なのか**を
コードのそばに書いてください。

## 落とし穴 3：target reasoning は低レベルに「経路長の上下限」が要ります

length constraint は頂点にも辺にも紐づきません。**agent の経路長そのものへの
制約**です。同 p.31 が実装上の要求を明記しています。

> 「In order to handle the length constraints, we need the low-level search to
> take into account bounds on the path length. This is fairly straightforward
> for given bounds e ≤ l2 ≤ u on the path length l2 of agent a2: If the
> low-level search reaches target vertex g2 before timestep e, then it cannot
> terminate but must continue searching; if it reaches the target vertex
> between timesteps e and u (and the agent was not at the target vertex at the
> previous timestep), then it terminates」

もう片方の枝は、同 p.31 いわく
「vertex g2 can be viewed as an obstacle after timestep t for all agents except
agent a2」——つまり **他の全 agent** に対する時刻 t 以降の頂点禁止です。
1 対の agent だけの話ではない点に注意してください。

★ 分類も特殊です。同 p.32:
「it can never be non-cardinal because the cost of the child CT node with the
additional length constraint l2 > t is always larger than the cost of the
parent CT node」。cardinal / semi-cardinal のどちらかにしかなりません。
さらに同 p.32 は「This is an approximate way of classifying target conflicts」
と**近似であること自体を断っています**。この但し書きは
`implementationNote` にも残してください。

## 落とし穴 4：MDD が要ります。ICTS のものは今のままでは使えません

rectangle の technique II / III と、corridor / target の分類は MDD を見ます
（同 p.27「it is semi-cardinal iff only one of the barrier constraint blocks all
paths on the corresponding MDD」など）。

MDD の構築は `src/solvers/joint/icts.ts` の中に**閉じた形で**あります。
そのままでは CBS から呼べません。共通化するか、CBS 用に別途作るかを
**着手前に相談してください。** 勝手に ICTS の内部を書き換えると、
検証済みの ICTS の最適性を壊す危険があります。

## 落とし穴 5：rectangle は適用条件が厳しい

同 p.14 Definition 5 (Rectangle Conflict) は「both agents follow their
Manhattan-optimal paths」を条件にしています。障害物が矩形内にある場合や
Manhattan 最短でない経路では**そもそも適用できません**。

また同 p.17 は
「We return the pair of barrier constraints only if they block the current paths
of the agents (Line 16), otherwise we would generate a child CT node whose paths
and conflicts are exactly the same with those of the [parent]」
と書いています。**現在の経路を塞がない barrier は返してはいけません。**
返すと同じ子ノードを作り続けて探索が進みません。corridor も同 p.35 / p.36 に
同じ趣旨の条件があります。

★ 適用できない場合は、**通常の vertex / edge 分岐へ素直に落ちてください。**
「対称性推論を必ず使う」実装にしないこと。

## 落とし穴 6：段階を分けて、各段で最適性を確認すること

3 つを一度に入れないでください。1 つ入れるたびに、既存の
「最適を主張する手法は参照実装と同じ sum of costs を返す」
（`tests/unit/solver-invariants.test.ts`）へその id を追加し、
**参照実装と 1 手も違わない**ことを確認してから次へ進んでください。

対称性推論は「探索を速くする」ものであって「答えを変える」ものではありません。
答えが変わったら、その時点で分岐が mutually disjunctive になっていません。

★ 速くなったことも数字で示してください。同じ盤面で、素の CBS と比べた
**展開ノード数**（`metrics.expandedNodes`）を報告に載せること。減っていなければ
実装が効いていないか、適用条件の判定が厳しすぎます。

# 確認済みの引用アンカー

以下はこちらで PDF 本文を確認済みです。そのまま使えます。
**これ以外のページ番号を書くときは、必ず自分で PDF を開いて確認してください。**

| ページ | 内容                                                              |
| ------ | ----------------------------------------------------------------- |
| p.3    | 3 種の対称性（rectangle / target / corridor）の位置づけ           |
| p.4    | §2 問題設定（classic MAPF、stay-at-target、sum of costs）         |
| p.6    | Definition 2 (Mutually Disjunctive) / Theorem 2                   |
| p.7    | Definition 3 (Cardinal, Semi-Cardinal, Non-Cardinal Conflicts)    |
| p.13   | Definition 4 (Rectangle)                                          |
| p.14   | Definition 5 (Rectangle Conflict)。Manhattan-optimal を要求       |
| p.15   | barrier constraint B(a_i, R_i, R_g) の定義（頂点制約の集合）      |
| p.16   | Theorem 3（rectangle reasoning technique I が保証を保つ）         |
| p.17   | 現在の経路を塞ぐ barrier だけを返す（Algorithm 1 Line 16）        |
| p.20   | Property 6 / Theorem 4（technique II）                            |
| p.25   | Definition 6 (Generalized Rectangle)                              |
| p.27   | MDD による分類 / Theorem 5（generalized rectangle）               |
| p.29   | §7 Target Symmetry の定義                                         |
| p.31   | length constraint と低レベルの経路長上下限、他 agent への障害物化 |
| p.32   | 分類は cardinal か semi-cardinal のみ・近似である旨 / Theorem 6   |
| p.33   | Definition 9 (Corridor)                                           |
| p.35   | 両 agent の経路を塞ぐときだけ分岐する                             |
| p.36   | Theorem 7（corridor conflicts を range constraints で解消）       |
| p.37   | §9.1 Pseudo-Corridor Conflicts                                    |
| p.44   | Theorem 8（generalized corridor、Algorithm 3 の制約集合）         |

# ライセンス

★ `cbsh2` / `cbsh2-rtc` の公開実装は **`copy_allowed: false`** です
（Batch 10 で確認済み）。**コードを見ない・写さないでください。** 論文と
自分の実装だけで書いてください。参照した公開実装がある場合は
`.references/` に置いて読むだけにし、何をどう参照したかを報告に書いてください
（`.references/` はコミットしない）。

# 実装する順番（推奨）

1. **分岐 API を「子ごとに制約の集合」へ広げる**（落とし穴 1）。
   既存 5 手法（CBS / ICBS / CBSH / DS / MA-CBS）の振る舞いが変わらないことを、
   既存テストで確認してから次へ。
2. **target-reasoning**。3 つの中で構造がいちばん単純。ただし低レベルの
   経路長上下限（落とし穴 3）が要る。
3. **corridor-reasoning**。range constraint は「時刻範囲の頂点禁止」なので、
   1 で広げた集合表現にそのまま乗る。pseudo-corridor（p.37）まで入れるかは
   相談してください。
4. **rectangle-reasoning**。MDD（落とし穴 4）と適用条件（落とし穴 5）があるので最後。
   technique I（p.16）だけでも価値があります。II / III まで入れるかは
   時間を見て判断し、**入れなかったものは全部報告に書いてください。**

# 着手前に報告してほしいこと

実装に入る前に、次を短く報告してください。

- 分岐 API をどう広げるか。既存 5 手法の移行方法
- MDD をどうするか（ICTS からの共通化 / CBS 用に別途 / 使わない範囲に絞る）
- length constraint を低レベルへどう渡すか
- 3 つのうちどこまでやるつもりか（technique II / III、pseudo-corridor の要否）

# 品質ゲート

[CODEX_PROMPT.md](CODEX_PROMPT.md) の品質ゲートをすべて通してください。
このバッチで特に効くのは次の 3 つです。

- `tests/unit/solver-invariants.test.ts` の「最適を主張する手法は参照実装と
  同じ sum of costs を返す」に**追加した id を必ず入れる**。
- 同ファイルの「プリセットと Solver の噛み合わせ」は探索上限 100 / 1000 で
  一周します。**打ち切ったときに有効な解を持っていれば `solved` を名乗ること**、
  **候補に出した Solver が `invalid-scenario` で落ちないこと**を見ています。
- 打ち切りの申告。**`search-exhausted` は「探索空間を尽くした＝解の非存在の
  証明」を意味します。** horizon や上限で切っただけならこれを返さないこと
  （`core.ts` の `finish()` に既に落とし込みがあります）。

★ **WSL のメモリが厳しいことがあります。** `npm test` を一度に流すと
OOM（exit 137）で落ちることがあったので、落ちたらファイル単位で分割して
流してください。

# 実装報告

[CODEX_PROMPT.md](CODEX_PROMPT.md) の形式で報告してください。加えて次を必ず含めること。

- 分岐 API をどう広げたか。既存 5 手法の振る舞いが変わっていないことの根拠
- 3 種それぞれについて、**2 枝が mutually disjunctive である理由**
- length constraint を低レベルでどう扱ったか（経路長の上下限）
- 適用条件を満たさないときに通常分岐へ落ちることの確認
- **素の CBS と比べた展開ノード数**（同じ盤面で）
- 実装しなかった論文の機能（technique II / III、pseudo-corridor など全部）
- マニフェストを更新した場合は、**どの PDF の何ページの何を読んだか**
