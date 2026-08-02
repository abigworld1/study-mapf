# Codex 用プロンプト — Batch 7（割当・TAPF）

> このファイルは Codex へそのまま貼るためのもの。`---` 以下を全部コピーして使う。
> [CODEX_PROMPT.md](CODEX_PROMPT.md) の**補足**であり、置き換えではない。

---

あなたは、探索アルゴリズム、組合せ最適化、Multi-Agent Path Finding（MAPF）を専門とする実装担当者です。

作業対象：`/home/hirayama/study-mapf`
公開 URL：`https://abigworld1.github.io/study-mapf/`

**まず [CODEX_PROMPT.md](CODEX_PROMPT.md) を最初から最後まで読んでください。**
そこに書かれた共通ルール（禁止事項、ライセンス、SolverResult / SolverEvent の型、
完成度ラベル、テスト方針、品質ゲート、実装報告の形式）はすべてそのまま適用されます。
このファイルは Batch 7 に固有の事情だけを足すものです。

# 今回の対象

```text
TARGET_ALGORITHMS:
- min-cost-max-flow   （最小費用最大流）
- hungarian-method    （ハンガリアン法）
- cbm                 （Conflict-Based Min-Cost-Flow）
- cbs-ta              （CBS with Task Assignment）
- gale-shapley        （Gale-Shapley 安定マッチング）
```

# 前回までとの一番の違い：TAPF の土台はもう出来ている

Batch 7 に入る前に、TAPF（target assignment and path finding）を扱うための
基盤を用意してあります。**これを使ってください。作り直さないでください。**

**着手前に必ず読むこと：**
[`docs/notes/implementation/tapf-baseline.md`](docs/notes/implementation/tapf-baseline.md)
（特に末尾の「Batch 7 への引き継ぎ」節）

用意済みのもの：

| ある物                                         | 場所                                                         |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `TeamSpec` / `Scenario.teams` / `kind: "tapf"` | `src/lib/model/types.ts`                                     |
| チーム不変条件の検証                           | `validateScenario`（`src/lib/model/scenario.ts`）            |
| TAPF プリセット 3 つ                           | `tapf-anonymous` / `tapf-crossing` / `tapf-two-teams`        |
| JSON 往復（teams 対応）                        | `scenarioToJson` / `scenarioFromJson`                        |
| `Scenario.kind` による Solver 絞り込み         | シミュレータと `registry.solversFor()`                       |
| `SolverResult.objective`                       | 最小化した量を画面に出す仕組み                               |
| `SolverResult.targetAssignments`               | 割当の表示（一覧＋盤面のラベル）                             |
| チーム target の描画                           | `src/lib/render/renderer.ts`（破線＝未割当、実線＝割当済み） |
| **最適性検証用オラクル `tapf-baseline`**       | `src/solvers/tapf/baseline.ts`                               |

`tapf-baseline` は「チーム内の割当を全通り試して CBS で解き、makespan 最小を返す」
だけの素朴な実装です。論文手法ではないので `algorithms.yaml` には登録していません。
小規模なら確実に makespan 最適なので、**CBM の検証に使ってください**（後述の落とし穴 1 も読むこと）。

# Batch 7 固有の落とし穴

## 落とし穴 1（最重要）：手法ごとに最小化する量が違う

**CBM は makespan を最小化し、CBS-TA は sum of costs を最小化します。**

- `cbm-tapf-aamas-2016` p.2：「the task is to find an optimal solution, namely one with **minimal makespan**」
- `cbs-ta-aamas-2018` p.2 Theorem 4.2：「CBS-TA computes a solution that **minimizes the sum of individual costs** of all agents」
- `cbs-ta-aamas-2018` p.1 は CBM について「minimizes the makespan …, which does not map well to minimizing idle time, where **the sum of all costs is a better metric**」と書き、両者を明確に区別しています。

守ること：

1. どちらの手法も `SolverResult.objective` を必ず設定する（`"makespan"` / `"sum-of-costs"`）。
   画面は SOC も makespan も出すので、言わないと「表示されている数値はどれも最適」と読まれます。
2. **CBM と CBS-TA の解を数値で直接比較しない。** 比較表や解説で並べるときは、
   別々の量を最適化していることを必ず添えてください。「CBM のほうが SOC が大きい」は
   欠陥ではありません。
3. **`tapf-baseline` は makespan 最適なので、CBS-TA の検証には使えません。**
   CBS-TA を検証するなら SOC 最小を選ぶオラクルが別に要ります。
   `tapf-baseline` の `isBetter` を差し替えた SOC 版を作るのが素直です
   （テスト専用にするか Solver として出すかは相談してください）。

これは LaCAM\* の sum-of-loss と同じ種類の罠で、この案件で一度やらかしています。

## 落とし穴 2：CBS-TA は今のチームモデルに載りません

`cbs-ta-aamas-2018` p.2 の問題定義は**チームではなく割当行列 A** です。
同ページに「Our formulation also allows cases where there are more goals than agents,
more agents than goals, or not all agents can reach all goals」とあります。

一方 `TeamSpec` は CBM 側（`cbm-tapf-aamas-2016` p.2）に寄せてあり、
「チームの target 数 = チームのエージェント数」を**不変条件として検査しています**。
チーム分割は割当行列のブロック対角な特殊形なので、CBS-TA を載せるにはモデル拡張が要ります。

**`TeamSpec` の不変条件を勝手に緩めないでください。** CBM の最適性の前提が消えます。
拡張案（別フィールドを足すか、`TeamSpec` を包む上位表現を作るか等）を
**実装前に報告してください。**

## 落とし穴 3：ハンガリアン法と Gale-Shapley は MAPF Solver ではありません

- どちらも経路を返さないので `MapfSolver` インタフェースに載りません。
- `algorithms.yaml` の `problem_types` は `[assignment]` ですが、
  `ProblemKind` に `"assignment"` はありません（`one-shot-mapf` / `lifelong-mapf` / `mapd` / `tapf`）。
- したがって registry に登録できず、`implementation_status` を `runnable` にできません。
  現行の判定（`src/lib/implementation-state.ts`）では、registry に無いものは
  `explanation-only` か `planned` にしかなりません。

推奨する形（ただし**勝手に決めず、着手前に案を報告すること**）：

- `src/lib/assignment/` に純関数として実装し、単体テストを付ける
- CBS-TA の K-best 割当と CBM から実際に使う
- 解説ページは持たせるが、シミュレータの手法一覧には出さない
- `implementation_status` をどう扱うかは要相談（`ProblemKind` を増やすのか、
  新しい状態を足すのか、`explanation-only` のままにするのか）

Gale-Shapley についてもう 1 点。`algorithms.yaml` の notes が
**「コスト最小化ではなく安定性（ブロッキングペアが存在しないこと）を保証する点で、
ハンガリアン法とは目的関数が異なる。この違いをサイト上で明示すること」**
と指示しています。解説ページでここを外さないでください。
安定マッチングはコスト最小マッチングとは別物です。

## 落とし穴 4：マニフェストの notes が古くなっています

`hungarian-method` / `gale-shapley` の notes にある
**「原論文が購読制で未取得のため guarantees は unknown」は、もう当てはまりません。**
5 本とも `docs/papers/` に PDF と `marker.md` が揃っています
（`papers.yaml` の `status: marker-ready`）。

やること：

- 5 本すべてを実際に読み、`guarantees` の `unknown` を根拠つきで確定させる
- notes の「未取得」という記述を消す
- `MISSING_PAPERS.md` に該当記述が残っていないか確認する

`min-cost-max-flow` の notes にある「flow アルゴリズム自体の原典
（Ford-Fulkerson 等）は未調査。要調査」は**まだ有効**です。
`network-flow-mapf-2012`（Yu & LaValle）は MAPF をフローとして定式化した論文であって、
最小費用流アルゴリズムそのものの原典ではありません。
原典を当てられないなら、当てられないと書いてください。**推測で埋めないこと。**

# ライセンスが Batch 6 と違います

Batch 6 の参照実装（MAPF-LNS / LNS2 / RHCR）は USC Research License で転記不可でしたが、
Batch 7 は状況が違います。

```text
libmultirobotplanning  whoenig/libMultiRobotPlanning
  license: MIT        copy_allowed: true
  pinned_commit: 4c75fa20c435c440d8b6bd6dc81668ddc7296ba0
  local_path: .references/libmultirobotplanning
```

- **CBS-TA 論文の第一著者 Wolfgang Hönig が管理しているリポジトリ**です。
- MIT なので転記は可能ですが、**著作権表示を必ず残し、`THIRD_PARTY_NOTICES.md` を更新**してください。
- ただし **AGENTS.md の原則どおり独立実装が基本**です。転記ではなく、挙動の照合に使ってください。

固定ケースとして使える資産があります。積極的に使ってください。

```text
.references/libmultirobotplanning/test/test_cbs_ta.py
.references/libmultirobotplanning/test/test_ecbs_ta.py
.references/libmultirobotplanning/test/test_assignment.py
.references/libmultirobotplanning/test/test_next_best_assignment.py
.references/libmultirobotplanning/test/mapfta_simple1_a*.yaml
```

同じ入力で cost / 割当が一致するか照合できれば、CBS-TA の完成度を
`reference-validated` にできます（一致しなければ `paper-faithful` に留めること）。

# 確認済みの引用アンカー

こちらで `pdftotext` で確認済みです。**それでも自分で再確認してください。**
Batch 6 では「結論 p.9」が実際は p.8、「Algorithm 1 p.3」が実際は p.4、
「Definition 1 p.2」が実際は p.1 という取り違えが 3 件ありました。

| 内容                                                     | ページ          |
| -------------------------------------------------------- | --------------- |
| CBM: TAPF の定義（チーム、同数 target、1 対 1 写像）     | p.2 §2.1        |
| CBM: makespan を最小化するという目的                     | p.2             |
| CBM: 「correct, complete and optimal」                   | p.2 / p.5 / p.6 |
| CBM: Theorem 3                                           | p.6             |
| CBM: 「全割当を探索する方法は scalability に難がある」   | p.2             |
| CBM: TAPF が匿名 MAPF と非匿名 MAPF を一般化する         | p.1             |
| CBS-TA: 問題定義と割当行列 A                             | p.2             |
| CBS-TA: Theorem 4.1（complete）/ Theorem 4.2（SOC 最小） | **p.3**         |
| CBS-TA: CBM の目的関数との違いを述べた箇所               | p.1             |
| CBS-TA: ECBS-TA への言及                                 | p.4 / p.5       |

ページ番号は必ず `pdftotext -f N -l N <pdf> - | grep ...` で裏を取ってから書いてください。

# 実装する順番（推奨）

1. **min-cost-max-flow** — CBM の低レベルがこれ。先に片付けると CBM が使える。
   時空間ネットワークの構成は `cbm-tapf-aamas-2016` p.2 と Theorem 1 にある。
   チーム 1 つの TAPF＝匿名 MAPF なので、`supports: ["tapf"]` の Solver として出せる。
2. **hungarian-method** — CBS-TA の K-best 割当の土台。純関数として実装。
3. **cbm** — 高レベルは CBS、低レベルをチームごとの最小費用流に差し替え。
   `tapf-baseline` と makespan が一致することをテストする。
4. **cbs-ta** — 落とし穴 2 のモデル拡張を先に相談してから。
   K-best 割当を根ノード群とする search forest（同 p.3–4）。
5. **gale-shapley** — 独立。目的関数の違い（安定性 ≠ コスト最小）の説明が主眼。

# 着手前に報告してほしいこと

次の 2 点は設計判断なので、**実装を始める前に案を出してください。**

1. 落とし穴 2：CBS-TA のための割当行列モデルをどう足すか
2. 落とし穴 3：ハンガリアン法と Gale-Shapley をサイト上でどう扱うか
   （registry に載せないなら `implementation_status` をどうするか）

# 品質ゲート

CODEX_PROMPT.md の品質ゲートをそのまま守ってください。加えて Batch 7 では：

- `npm run sources:validate` が `errors=0`
- 5 手法すべての `guarantees` から `unknown` が消えている
  （消せないものは、なぜ消せないかを根拠つきで notes に書く）
- TAPF の Solver は `objective` を必ず設定している
- CBM は `tapf-baseline` と makespan が一致する（小規模ケース）
- CBS-TA は `tapf-baseline` と**比較しない**。SOC 用のオラクルを別に用意する
- 既存の TAPF プリセット 3 つが、新しい手法でも解ける
- `TeamSpec` の不変条件（target 数 = エージェント数）が壊れていない
- registry に載せた手法は `supports` が正しく、シミュレータの絞り込みと整合する

# 実装報告

CODEX_PROMPT.md の形式で。加えて次を明記してください。

- 各手法が最小化した量（makespan / sum of costs / それ以外）
- `tapf-baseline` との照合結果（CBM のみ。CBS-TA は別オラクル）
- `libmultirobotplanning` との固定ケース照合結果（一致 / 不一致 / 未実施）
- 落とし穴 2・3 について最終的に採った設計
- 確定できなかった保証と、その理由
