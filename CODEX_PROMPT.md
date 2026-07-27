# Codex 用プロンプト（改訂版）

> このファイルは Codex へそのまま貼るためのもの。
> `---` 以下を全部コピーして使う。
> **`TARGET_ALGORITHMS` を実行前に編集すること。**
>
> 初版からの主な変更点:
>
> - `SolverResult` / `SolverEvent` / 完成度ラベルを、実際に存在する型名へ修正した
> - 参照ソルバ（最適性検証用オラクル）と安全弁 API が用意されたので、その使い方を追記した
> - 確定した理論保証を `docs/sources/algorithms.yaml` へ書き戻す指示を追加した
> - `npm install` → `npm ci`、品質ゲートに `npm run sources:validate` を追加した
> - Batch 1 の一部は既に簡略実装が存在するため「差し替え」と明記した

---

あなたは、探索アルゴリズム、組合せ最適化、Multi-Agent Path Finding（MAPF）、Multi-Agent Pickup and Delivery（MAPD）を専門とする実装担当者です。

作業対象：

```text
/home/hirayama/study-mapf
```

公開予定URL：

```text
https://abigworld1.github.io/study-mapf/
```

サイトの情報設計、UI基盤、Solver API、シミュレータ基盤は作成済みです。
あなたの仕事は、指定されたアルゴリズムについて、原論文に忠実な独立実装、テスト、可視化イベント、初学者向け解説を追加することです。

# 今回の対象

以下を実行前に編集してください。

```text
TARGET_ALGORITHMS:
- <algorithm-1>
- <algorithm-2>
- <algorithm-3>
```

例：

```text
TARGET_ALGORITHMS:
- Space-Time A*
- SIPP
- Cooperative A*
- WHCA*
```

# 最初に読むもの

順に目を通してください。読まずに実装を始めないでください。

| ファイル                            | 内容                               |
| ----------------------------------- | ---------------------------------- |
| `AGENTS.md`                         | 作業規約。禁止事項もここ           |
| `SOURCE_POLICY.md`                  | 資料の取り扱い 12 条。**最重要**   |
| `ARCHITECTURE.md`                   | サイトの構造と設計判断の理由       |
| `ALGORITHM_IMPLEMENTATION_GUIDE.md` | Solver の追加手順。API の詳細      |
| `CONTENT_GUIDE.md`                  | 解説ページの書き方                 |
| `IMPLEMENTATION_STATUS.md`          | 現在の実装状況と、使える検証道具   |
| `src/lib/model/types.ts`            | 共通型の定義。**実装前に必ず読む** |

# 絶対に守る優先順位

情報源の優先順位は次です。

1. `docs/papers/<paper-id>/paper.pdf`
2. `docs/papers/<paper-id>/marker.md`
3. 原論文の補足資料、errata、著者ページ
4. `.references/` 内の著者または公式実装
5. サーベイ
6. 第三者実装

Marker Markdown に数式崩れ、表崩れ、疑似コード崩れがある場合は、必ず PDF を確認してください。

`docs/papers/<paper-id>/metadata.yaml` の `machine_index` に、PDF から機械抽出した
Algorithm / Theorem / Figure 番号とページがあります。**当たりを付けるのには使えますが、
そのまま出典にはできません。** 目で確認してから書いてください。

同 `verification.notes` に、変換時の既知の問題が記録されている論文があります。
たとえば `astar-1968` は marker.md の 1-62 行目が別論文の参考文献、
`gale-shapley-1962` は 145-150 行目が次の論文です。該当ページは先に読んでください。

PDF と公開実装が異なる場合は、どちらかを黙って採用せず、次を記録してください。

```text
論文で定義された方式
公開実装で採用された方式
今回のブラウザ実装で採用した方式
差異を選んだ理由
```

# ライセンス

`.references/` 内のコードを直接コピーしないでください。

転記してよいのは `docs/sources/repositories.yaml` で `copy_allowed: true` の 10 件（MIT）だけです。
残り 14 件は読むだけです。特に次に注意してください。

- **USC 独自ライセンス 7 件**（`pbs` `eecbs` `rhcr` `mapf-lns` `mapf-lns2` `cbsh2` `cbsh2-rtc`）
  教育・研究・非営利限定。GitHub の自動判定は `NOASSERTION` を返すだけですが、標準的な OSS ライセンスではありません
- **`primal` / `primal2`** LICENSE.md の著作権者が `.NET Foundation` になっており、プロジェクトの権利者と一致しません
- **ライセンスファイルが無い 5 件**（`push-and-rotate-cbs-pp` `public-cppmomapf` `mapf-icbs` `mapf-lns-unified` `awesome-mapf`）

寛容なライセンスのコードを一部利用する場合は、以下をすべて行ってください。

- ライセンス条文を読む
- 著作権表示を保持する
- NOTICE があれば同梱する
- ソースファイルへ出典コメントを書く
- **`THIRD_PARTY_NOTICES.md` へ追記する**（形式はファイル内に書いてあります）

ライセンスが不明なコードはコピー禁止です。

# 作業開始時の確認

```bash
cd /home/hirayama/study-mapf
git status
npm ci
npm run sources:validate
npm run typecheck
npm test
```

いずれも通る状態から始まります（`sources:validate` は `errors=0 warnings=5`、
テストは 75 件通過）。失敗する場合は、今回の変更による失敗かどうかを分離してください。

大規模なアーキテクチャ変更は行わず、既存の Solver API へ適合させてください。

# アルゴリズムごとの調査メモ

各対象アルゴリズムについて、**実装前に**次のファイルを作成してください。

```text
docs/notes/implementation/<algorithm-id>.md
```

雛形が `docs/notes/implementation/_TEMPLATE.md` にあります。そのまま埋めてください。
書けない項目があるなら、まだ実装を始める段階ではありません。

保証が確認できない場合は「不明」としてください。

# 共通ルールの確認

サイトが採用する MAPF モデルは `src/lib/model/types.ts` の冒頭と `/simulator/` ページに書いてあります。

```text
4 近傍グリッド、離散時間、move または wait
vertex conflict           禁止
edge-swap conflict        既定で禁止（rules.forbidEdgeSwap）
following conflict        既定で許可（rules.forbidFollowing）
goal 到達後               既定 stay（rules.goalBehavior）
```

次の違いを混同しないでください。

```text
vertex conflict / edge-swap conflict / following conflict / cycle conflict
goal occupancy / stay at goal / disappear at goal
sum of costs / makespan
one-shot MAPF / iterative MAPF / lifelong MAPF
online MAPD / offline MAPD / TAPF
```

論文の定義とサイトの既定が異なる場合は、`SolverOptions.extra` かページ上の注意書きで明示してください。
`SimulationRules` に無い前提が要る場合は、`metadata.unsupportedRules` で弾くか、
`SolverWarning` の `simplified-behavior` で伝えてください。**黙って別のルールで解かないでください。**

# 実装要件

各 Solver は `src/lib/model/types.ts` の `MapfSolver` へ適合させてください。

```ts
interface MapfSolver {
  readonly metadata: SolverMetadata;
  solve(scenario: Scenario, options: SolverOptions, context: SolverContext): Promise<SolverResult>;
}
```

要件：

- TypeScript strict（`noUncheckedIndexedAccess` も有効）
- 決定的な seed。**`Math.random()` は禁止。`context.random()` を使う**
- **`Date.now()` は禁止。`context.now()` を使う**
- 明示的なタイブレーク（論文が未指定なら、選んだ規則を実装ノートに書く）
- `context.signal`（`AbortSignal`）を定期的に見る
- タイムアウトと最大展開数
- **入力サイズのガードは `checkLimits()` を呼ぶ**（下記）
- Web Worker で動く（`src/solvers/worker.ts` が registry 経由で呼ぶ。特別な対応は不要）
- 例外を投げず、`outcome` と `error` で構造化して返す
- 実行統計を返す
- `SolverEvent` を出す
- UI と探索ロジックを分離する。Canvas / DOM のコードを Solver に入れない
- グローバル可変状態を避ける

## 入力サイズのガード（必須）

探索を始める前に必ず呼んでください。ブラウザを固まらせないためです。

```ts
import { checkLimits } from "../limits.js";

const limits = checkLimits(scenario, options);
if (!limits.ok) return limits.result!;
```

`SolverOptions` に次の上限があります。既定値は `DEFAULT_SOLVER_OPTIONS`。

```text
timeoutMs        10_000
maxExpansions    2_000_000
maxAgents        200
maxGridArea      40_000
maxHorizon       2_000
maxTraceEvents   20_000
traceLevel       "summary"
```

手法ごとに調整が要る場合は、`metadata` に推奨値を書き、UI から渡せるようにしてください。

# SolverResult（実際の型）

**初版のフィールド名は実際の型と違っていました。以下が正です。**

```ts
interface SolverResult {
  outcome: "solved" | "no-solution" | "timeout" | "node-limit" | "aborted" | "error";
  paths: readonly TimedPath[];
  metrics: SolverMetrics;
  conflicts: readonly Conflict[]; // 解に「残った」衝突。solved なら空
  assignments?: readonly { taskId; agentId; time }[]; // MAPD
  error?: SolverErrorInfo;
  failureReason?: FailureReason;
  warnings?: readonly SolverWarning[];
  trace?: readonly SolverEvent[];
}

interface SolverMetrics {
  sumOfCosts: number;
  makespan: number;
  runtimeMs: number;
  expandedNodes?: number;
  generatedNodes?: number;
  conflictsDetected?: number; // 検出した総数（conflicts とは別物）
  replans?: number;
  lowerBound?: number;
  suboptimalityBound?: number;
  averageServiceTime?: number; // MAPD
  throughput?: number; // MAPD
  pendingTasks?: number; // MAPD
}
```

対応関係（初版 → 実際）:

| 初版の名前                                          | 実際                                                         |
| --------------------------------------------------- | ------------------------------------------------------------ |
| `status`                                            | `outcome`                                                    |
| `cost`                                              | `metrics.sumOfCosts`（目的関数を明示したいなら実装ノートへ） |
| `sumOfCosts` `makespan` `runtimeMs` `expandedNodes` | `metrics.*` の下                                             |
| `failureReason`                                     | `failureReason`（`FailureReason` 型。`error` とは別）        |
| `trace`                                             | `trace`。`createTraceRecorder()` を使う                      |

**値を計測できない項目は 0 で捏造せず、フィールドごと省略してください。**
`0` は「数えた結果 0 だった」を意味します。

`buildResult()` に第 6 引数 `ExtraMetrics` を渡せます。`lowerBound` を渡すと
`suboptimalityBound` が自動計算されます。

## trace の記録

```ts
import { createTraceRecorder } from "../context.js";

const recorder = createTraceRecorder(options);
const emit = (e: SolverEvent) => {
  recorder.record(e); // traceLevel と maxTraceEvents に従って間引く
  context.emit(e); // UI へは常に流す（Worker 側でも別途間引く）
};
// ...
return { ...result, trace: recorder.events, warnings: recorder.warnings };
```

# 可視化イベント（実際の型）

`SolverEvent` は `src/lib/model/types.ts` に定義済みです。**以下はすべて既に型にあります。**
新しい種類が必要なら union へ追加してください（それは許容される変更です）。

共通:

```text
expand-node / reserve / detect-conflict / add-constraint / set-priority
inherit-priority / backtrack / destroy-neighborhood / repair-neighborhood
assign-task / move / progress / finish / replan
```

時空間探索・SIPP:

```text
discover-safe-interval / reject-reserved-state
```

CBS 系:

```text
classify-conflict / create-ct-node / low-level-replan / bypass
```

PBS:

```text
update-priority-dag / replan-lower-priority-agent
```

PIBT:

```text
priority-order / candidate-evaluation
```

LaCAM:

```text
configuration-expand / create-low-level-node / add-lazy-constraint / configuration-generate
```

LNS:

```text
select-neighborhood / accept-solution / reject-solution / update-incumbent
```

MAPD:

```text
release-task / swap-task / pickup / delivery / update-token
```

詳細度は `options.traceLevel`（`off` / `summary` / `detailed` / `verbose`）で制御します。
どのイベントがどの詳細度に入るかは `src/solvers/limits.ts` の `shouldRecord()` にあります。
新しいイベントを足したら、この振り分けにも追加してください。

# 完成度ラベル（実際の型）

`SolverMetadata` には**2 つの軸**があります。混同しないでください。

```ts
status: "runnable" | "partial" | "explanation-only" | "planned"; // 動くかどうか
fidelity: "educational" | "paper-faithful" | "reference-validated" | "explanation-only"; // 再現度
```

```text
educational          原理を学ぶための簡略実装
paper-faithful       原論文の主要処理を実装
reference-validated  公開実装または既知結果と照合済み
explanation-only     実行可能な再現実装なし
```

一部だけ実装した状態を `reference-validated` にしないでください。
`reference-validated` にする場合は `validatedAgainst` に**何と何をどう比べたか**を書いてください。

PRIMAL / PRIMAL2 など、学習済みモデル・学習環境・重い依存が必要な手法は、
モデルとライセンスを確認できない限り `explanation-only` としてください。

**実装していないアルゴリズムを `src/solvers/registry.ts` に登録しないでください。**
選択肢に出ること自体が「動く」という意味になります。

# 検証に使える道具（用意済み）

## 参照ソルバ（オラクル）

`src/solvers/reference/joint-state.ts`

```ts
jointStateBfs(scenario, maxTime?)              // makespan 最適。BFS なので保証あり
jointStateOptimalSumOfCosts(scenario, maxExtraCost?)  // sum of costs 最適。IDA*
```

- **極小インスタンス専用**（エージェント 5 体 / 通行可能セル 36 以下）。
  超えると `ReferenceSolverTooLarge` を投げます。黙って間違った答えは返しません
- `jointStateOptimalSumOfCosts` は `sumOfCostsCertified` が `true` のときだけ最適を主張できます。
  `false` は「予算内に見つからなかった」だけで、解が無いとは限りません
- `jointStateBfs` の戻り値は makespan 最適であって SOC 最適ではありません（`sumOfCostsCertified: false`）

**registry に登録しないでください。** テスト専用です。

## 解の不変条件チェック

`tests/unit/invariants.test.ts` の `checkPaths()` を再利用してください。
壁通過・跳躍・時刻の連続性・vertex/edge-swap 衝突・開始位置・ゴール到達をまとめて検査します。

## 論文と marker.md の機械照合

```bash
npm run sources:fidelity                      # 全 52 本
node scripts/check-marker-fidelity.mjs cbs-aij-2015
```

丸ごと落ちた Algorithm / Theorem / Figure と、語数の目減りを検出します。
**数式の中身が正しいかは判定していません。**

# 解説ページ

各対象手法の既存 MDX（`src/content/algorithms/<algorithm-id>.mdx`）を更新してください。
現在はすべて骨格（`status: draft`、本文は `<PreparingNotice />` のみ）です。

書き方は `CONTENT_GUIDE.md` に従ってください。要点だけ再掲します。

- 本文は日本語。アルゴリズム名・変数名・専門用語は英語を併記する
- 長い原文引用をしない（1 箇所 1〜2 文まで）。図表は貼らず描き直す
- 出典は `<SourceCitation paperId="..." section="5.1" label="Algorithm 1" page={7} />`
  → `[cbs-aij-2015, §5.1, Algorithm 1, p.7]`
- **実際に PDF で確認していないページ番号を書かない**
- frontmatter の `status` を実態に合わせる（`draft` / `reviewed` / `verified`）
- 資料が足りない節は無理に埋めず飛ばす

含める節（レイアウトが自動で出す「理論保証」「原論文」「公開実装」は本文に書かない）:

```text
概要 / まず何がうれしいのか / 前提となる知識 / 対象問題 / 中心となるアイデア
アルゴリズムの手順 / 小さな例 / データ構造 / 疑似コード
実装上の注意 / よくある誤解 / 他手法との比較 / サイト上の実装との差異 / 実験してみる
```

「サイト上の実装との差異」は必ず書いてください。簡略化した箇所を隠さないでください。

## 疑似コード

論文の疑似コードをそのまま長く転載しないでください。

- 変数名をサイトの共通モデルへ合わせる
- 構造は保持する
- 教材用に短く再構成する
- 省略した処理を明記する
- 原論文の Algorithm 番号を示す
- 実装コードとの対応を説明する

# ★ 理論保証は必ずマニフェストへ書き戻す

PDF を読んで理論保証を確定させたら、実装ノートに書くだけでなく
**`docs/sources/algorithms.yaml` の `guarantees` と `guarantee_evidence` を更新してください。**

```yaml
guarantees:
  complete: true # true | false | conditional | unknown
  optimal: true
  bounded_suboptimal: false
guarantee_evidence: "cbs-aij-2015 p.12 Theorem 1「CBS returns an optimal solution.」"
```

サイトの保証表（`GuaranteeTable`）は**マニフェストだけを見ています**。
実装ノートに書いただけでは反映されません。

現在 60 / 77 手法に `unknown` が残っています。確認できたものから減らしてください。
**確認できないものは `unknown` のままにしてください。推測で埋めないでください。**

更新後は必ず `npm run sources:validate` を実行してください
（`true` / `conditional` を書いて `guarantee_evidence` が無いと error になります）。

# テスト方針

## 共通不変条件

成功結果について、`checkPaths()` で次を検証してください。

- 壁を通過しない
- 各移動が wait または隣接セルへの移動
- vertex conflict がない
- edge-swap conflict がない
- 開始位置が正しい
- ゴール条件が正しい
- cost / makespan 計算が正しい

## 最適手法

CBS、ICTS など最適性を主張する手法では、**極小インスタンス**について
`jointStateOptimalSumOfCosts()` と比較してください。

```ts
const oracle = jointStateOptimalSumOfCosts(scenario, 8);
if (oracle.solved && oracle.sumOfCostsCertified) {
  expect(result.metrics.sumOfCosts).toBe(oracle.sumOfCosts);
}
```

最適性を確認できるサイズだけで実施してください。大きなケースで総当たりを行わないでください。

## bounded-suboptimal 手法

BCBS、ECBS、EECBS などでは、小規模ケースについて次を検証してください。

```ts
expect(result.metrics.sumOfCosts).toBeLessThanOrEqual(w * optimalCost + 1e-9);
```

浮動小数点誤差を考慮してください。

## 不完全手法

Prioritized Planning などでは、成功例だけでなく
**解が存在しても優先順位によって失敗する既知の小規模例**を追加してください。

参考: `swap-conflict` プリセットは、退避場所を中央に置くと固定優先順位では解けなくなります
（現在は解ける位置に調整済み）。この性質をテストに使えます。

不完全な手法を、テストが通ったことだけで完全と記述しないでください。

## MAPD

- pickup より前に delivery しない
- 一つのタスクを重複実行しない
- release time より前に取得しない
- pickup 後に指定 delivery へ到達する
- task swap 時に所有者が一意
- 未処理タスク数が一致
- service time が定義どおり
- throughput が定義どおり

# 公開実装との比較

`.references/` の実装をビルドできる場合、小さな固定インスタンスで比較してください。

比較対象: success/failure、solution cost、makespan、path validity、determinism

**完全に同じ経路を要求しないでください。** 異なる最適経路が存在します。
タイブレークの違いによる差は差異として記録してください。

ビルドできない場合は理由を実装ノートに記録してください。
なお `lacam0` `lacam2` `lacam3` `pibt2` `mapf-visualizer` `mapf-lns-unified` は
サブモジュール未取得のため、そのままではビルドできません
（`mapf-lns-unified` は SSH 形式のサブモジュールを含みます）。

# 実装する順番

対象が複数ある場合、次の依存順を守ってください。

```text
基礎データ構造 → 単一エージェント探索 → 衝突判定 → 共通テスト
→ 対象 Solver → イベント可視化 → シミュレータ統合 → 解説ページ → 比較表 → E2E
```

比較表とシミュレータの選択肢は `registry.ts` から自動生成されるため、
個別の更新は不要です。

# 推奨バッチ

一度にすべて実装しないでください。

## Batch 1

```text
Space-Time A*     ← 既存の簡略実装（partial / educational）を差し替える
SIPP              ← 新規
Prioritized Planning ← 既存の簡略実装（runnable / educational）を差し替える
Cooperative A*    ← 新規
WHCA*             ← 新規
```

既存の 2 つは基盤の動作確認用です。差し替えるときは、
既存テスト（`tests/unit/solvers.test.ts`、`tests/unit/invariants.test.ts`）が
通り続けることを確認してください。

## Batch 2 以降

```text
Batch 2: CBS / BCBS / ECBS / ICBS / EECBS
Batch 3: PBS / PIBT / winPIBT
Batch 4: ICTS / M* / Push and Swap / Push and Rotate
Batch 5: LaCAM / LaCAM*
Batch 6: MAPF-LNS / MAPF-LNS2 / RHCR
Batch 7: Hungarian Algorithm / Min-Cost Max-Flow / Gale-Shapley / CBM / CBS-TA
Batch 8: TP / TPTS / CENTRAL / MLA* / HBH+MLA*
Batch 9: RMCA / LNS-PBS / LNS-wPBS
```

学習ベース手法（PRIMAL / PRIMAL2）は最後にしてください。

# 品質ゲート

変更後に次をすべて実行してください。

```bash
npm run sources:validate    # errors=0 であること
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

可能なら E2E も実行してください。

```bash
npx playwright install chromium   # 初回のみ
npm run test:e2e
```

既存テストを削除、skip、弱体化して通してはいけません。
タイムアウト値を不必要に大きくしてはいけません。

# 実装報告

作業後に次を作成または更新してください。

```text
docs/notes/implementation/<algorithm-id>.md
IMPLEMENTATION_STATUS.md
WORKLOG.md
docs/sources/algorithms.yaml        ← 確定した理論保証
THIRD_PARTY_NOTICES.md              ← コードを取り込んだ場合のみ
```

最後にターミナルへ、以下を簡潔に報告してください。

1. 対象アルゴリズム
2. 参照した論文と節
3. 参照した公開実装
4. 実装したファイル
5. 追加したテスト
6. テスト結果
7. ビルド結果
8. 理論保証（および `algorithms.yaml` へ書き戻した内容）
9. 論文と公開実装との差異
10. ブラウザ版で簡略化した部分
11. 未対応部分
12. 次の推奨バッチ

# 禁止事項

- 原論文を確認せず実装する
- 理論保証を推測する
- 確認していないページ番号を書く
- Marker Markdown の誤変換をそのまま採用する
- 第三者コードを無断コピーする
- `copy_allowed: true` 以外のリポジトリからコードを転記する
- 巨大なリファクタリングを同時に行う
- UI 都合でアルゴリズムの意味を変える
- テストを削除して成功させる
- 実装していない機能を実装済みと表示する
- 実装していないアルゴリズムを `registry.ts` へ登録する
- 失敗を例外として握りつぶす
- `Math.random()` / `Date.now()` を Solver 内で使う
- 計測していない統計を 0 で埋める
- ブラウザを長時間フリーズさせる
- `/study-mapf/` のベースパスを文字列で書く（`withBase()` を使う）
