# ALGORITHM_IMPLEMENTATION_GUIDE.md — Solver の追加方法

シミュレータで動くアルゴリズムを追加する手順。
解説ページの書き方は [CONTENT_GUIDE.md](CONTENT_GUIDE.md) を参照。

---

## 大原則

**実装していないアルゴリズムを registry に登録してはならない。**

シミュレータの選択肢に出ること自体が「動く」という意味になる。
部分的にしか実装できていない場合は `status: "partial"` にし、
`implementationNote` に何を簡略化したかを書く。

---

## 手順

### 1. `algorithms.yaml` に手法が登録されていることを確認する

`metadata.id` は `docs/sources/algorithms.yaml` の `algorithm-id` と**一致させる**。
無ければ先にマニフェストへ追加する（[README.md](README.md) の「新しい論文の追加方法」）。

### 2. 実装ファイルを置く

```
src/solvers/<category>/<name>.ts
```

カテゴリの例: `basic/` `low-level/` `prioritized/` `cbs/` `pibt/` `lns/` `mapd/`

### 3. `MapfSolver` を実装する

```ts
import type {
  MapfSolver,
  Scenario,
  SolverContext,
  SolverOptions,
  SolverResult,
} from "@/lib/model/types.js";
import { buildResult, checkAbort, defaultMaxTime, emptyResult } from "../shared.js";

export const myCbsSolver: MapfSolver = {
  metadata: {
    id: "cbs", // algorithms.yaml と一致させる
    displayName: "CBS",
    originalName: "Conflict-Based Search",
    category: "cbs",
    supports: ["one-shot-mapf"],
    status: "runnable", // または "partial"
    basedOnPaperIds: ["cbs-aij-2015"],
    implementationNote:
      "高レベルは best-first、低レベルは時空間 A*。原論文の改良（PC / BP / ヒューリスティクス）は未実装。",
  },

  async solve(scenario, options, context): Promise<SolverResult> {
    const startedAt = context.now();

    // ... 探索 ...

    return buildResult(scenario, paths, context.now() - startedAt, expanded);
  },
};
```

### 4. registry に登録する

```ts
// src/solvers/registry.ts
import { myCbsSolver } from "./cbs/cbs.js";

const SOLVERS: readonly MapfSolver[] = [
  bfsSolver,
  aStarSolver,
  spaceTimeAStarSolver,
  prioritizedPlanningSolver,
  myCbsSolver, // ← 追加
];
```

これだけで次が自動更新される。

- シミュレータの手法選択
- アルゴリズムページのバッジ（「シミュレータで実行可」）
- 比較表の「シミュレータ対応」列
- トップページの実装済み件数

### 5. テストを書く

`tests/unit/solvers.test.ts` に足すか、新しいファイルを作る。最低限これを検査する。

- 小さな既知のインスタンスで期待コストが出る
- `solved` を返したとき衝突が 0 件
- 同じ seed と同じ入力で結果が一致する
- 到達不能なインスタンスで `no-solution` を返す

`tests/unit/invariants.test.ts` の `checkPaths()` を再利用すると、
壁通過・跳躍・衝突・ゴール未到達をまとめて検査できる。

---

## 守るべき規約

### 決定性

```ts
// ✗ 禁止
const r = Math.random();

// ✓
const r = context.random();
```

`context.random()` は seed から作られる（mulberry32）。
`Math.random()` を使うと「同じ seed と同じ入力なら同じ結果」が壊れ、テストが不安定になる。

時刻も同じ。

```ts
// ✗ 禁止
const t = Date.now();

// ✓
const t = context.now();
```

### 中断とタイムアウト

ループの中で定期的に確認する。

```ts
const abort = checkAbort(startedAt, context.now, options.timeoutMs, context.signal);
if (abort !== "ok") return emptyResult(abort, context.now() - startedAt);
```

`abort` は `"timeout" | "aborted"` を返す。そのまま `outcome` として使える。

### 展開上限

```ts
if (expanded > options.maxExpansions) {
  return emptyResult("node-limit", context.now() - startedAt);
}
```

### 例外を投げない

UI へは `outcome` と `error` で構造化して返す。

```ts
return emptyResult("error", context.now() - startedAt, {
  code: "invalid-scenario", // not-implemented | invalid-scenario | internal | unsupported-rules
  message: "a1 に目標が設定されていません",
});
```

Worker 側で例外を捕まえる仕組みはあるが、想定内の失敗は `outcome` で表す。

### 対応できないルール

`Scenario.rules` は既定から変わりうる（`goalBehavior` / `forbidEdgeSwap` /
`forbidFollowing` / `allowDiagonal`）。対応できないものがあれば宣言し、実行時にも弾く。

```ts
metadata: {
  unsupportedRules: ["allowDiagonal"],
  // ...
}

if (scenario.rules.allowDiagonal) {
  return emptyResult("error", 0, {
    code: "unsupported-rules",
    message: "この実装は 4 近傍のみに対応しています",
  });
}
```

**黙って別のルールで解かないこと。** 結果が正しく見えて実は違う、が一番まずい。

---

## 可視化のためのイベント

`context.emit()` で内部動作を流すと、シミュレータが可視化できる。
描画側は Solver の内部状態を直接見ない設計なので、イベントを出さないと何も見えない。

| イベント                                       | いつ出すか                            |
| ---------------------------------------------- | ------------------------------------- |
| `expand-node`                                  | 低レベル探索がノードを展開したとき    |
| `reserve`                                      | 予約表へ登録したとき                  |
| `detect-conflict`                              | 衝突を検出したとき                    |
| `add-constraint`                               | CT ノードへ制約を足したとき（CBS 系） |
| `set-priority`                                 | 優先順位を決めたとき（PBS 系）        |
| `inherit-priority`                             | 優先度継承したとき（PIBT）            |
| `backtrack`                                    | バックトラックしたとき                |
| `destroy-neighborhood` / `repair-neighborhood` | LNS の破壊・修復                      |
| `assign-task`                                  | MAPD でタスクを割り当てたとき         |
| `progress`                                     | 進捗（`ratio` は 0..1）               |
| `finish`                                       | 最後に必ず 1 回                       |

`expand-node` は大量に出るので、Worker 側で間引いている（上限 4000 件）。
Solver 側で抑制する必要はない。

---

## 低レベル探索の再利用

時空間 A* は `src/solvers/low-level/space-time-astar.ts` にある。
予約表を渡せば他エージェントを避ける。CBS の低レベルにも使える。

```ts
const out = spaceTimeAStar({
  map: scenario.map,
  start: agent.start,
  goal: agent.goal,
  agentId: agent.id,
  rules: scenario.rules,
  reservations: table, // 省略すると単一エージェント A*
  reservationHorizon: maxTime,
  maxTime,
  maxExpansions: 100_000,
  heuristic: trueDistanceFrom(scenario.map, agent.goal), // 事前計算した真距離
  onExpand: (cell, time) =>
    context.emit({ type: "expand-node", agentId: agent.id, state: { cell, time } }),
});
```

制約（`Constraint`）を渡す口はまだ無い。CBS を実装するときは、
制約集合を予約表へ変換するか、`spaceTimeAStar` に制約引数を足す。
**後者を選ぶ場合は既存の呼び出しを壊さないこと**（引数は任意にする）。

---

## 実装が原論文と違う場合

必ず書く。2 箇所に。

1. `metadata.implementationNote` — シミュレータと解説ページに表示される
2. `docs/sources/repositories.yaml` の `notes` — 参照実装と挙動が違う場合

**「原論文の完全な再現ではない」ことを隠さない。**
教材なので、簡略化した箇所を明示するほうが価値がある。

---

## チェックリスト

- [ ] `metadata.id` が `algorithms.yaml` の `algorithm-id` と一致している
- [ ] `Math.random()` / `Date.now()` を使っていない
- [ ] `AbortSignal` を見ている
- [ ] タイムアウトと展開上限で止まる
- [ ] 例外を投げず `outcome` で返す
- [ ] 対応できないルールを宣言し、実行時にも弾く
- [ ] `finish` イベントを 1 回出す
- [ ] 同じ seed と同じ入力で結果が一致するテストがある
- [ ] `solved` のとき衝突 0 件のテストがある
- [ ] `implementationNote` に簡略化した点を書いた
- [ ] `npm test` と `npm run typecheck` が通る
