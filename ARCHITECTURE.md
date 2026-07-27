# ARCHITECTURE.md — サイトの構造と設計判断

## 全体像

```
docs/sources/*.yaml          単一情報源（論文・実装・手法）
        │
        │ ビルド時に ?raw で埋め込み → mini-yaml でパース
        ▼
src/lib/manifest.ts          型付きアクセサ
        │
        ├──▶ src/lib/nav.ts            ナビゲーション
        ├──▶ src/pages/algorithms/     一覧・分類・個別ページ
        ├──▶ src/pages/compare.astro   比較表
        └──▶ src/components/sources/   出典表示コンポーネント

src/content/algorithms/*.mdx  解説本文（frontmatter に出典）
        │
        ▼
src/layouts/AlgorithmLayout.astro  共通テンプレート

src/lib/model/               ドメインモデル（グリッド・衝突・予約表・シナリオ）
        │
        ├──▶ src/solvers/            Solver 実装と registry
        │        │
        │        └──▶ src/solvers/worker.ts   Web Worker で実行
        │
        └──▶ src/lib/render/renderer.ts       Canvas 2D 描画
                     │
                     ▼
        src/components/simulator/Simulator.tsx  React island
```

---

## 設計判断とその理由

### 1. マニフェストを単一情報源にする

手法の一覧・分類・保証・出典は `docs/sources/*.yaml` にしかない。
サイトのページはそこから生成する。

**理由**: 同じ情報を複数箇所に書くと必ずずれる。特に「理論保証」がずれると、
教材として致命的な誤りになる。

**帰結**: 手法を足すときは YAML を直す。ページ側にハードコードしない。

### 2. YAML の読み込みに `?raw` を使う

```ts
import papersYaml from "../../docs/sources/papers.yaml?raw";
```

**理由**: `fs.readFileSync` + `import.meta.url` は使えない。
Astro の prerender ではこのモジュールが `dist/.prerender/` へバンドルされるため、
`import.meta.url` が出力先を指し、`docs/` を見つけられない（実際に ENOENT でビルドが落ちた）。

### 3. YAML パーサを自作する

`scripts/lib/mini-yaml.mjs`（依存ゼロ）をサイトからも使う。

**理由**: バリデータ（`scripts/validate-sources.mjs`）と**同じ解釈**でなければ、
「検証は通るがサイトでは壊れる」が起きる。パーサを 2 つ持たない。

**注意**: 対応する構文は意図的に狭い。未対応の構文は黙って無視せず例外を投げる。
一度 Prettier が `authors: [...]` を複数行へ折り返してパースできなくなったため、
複数行フローシーケンスには対応済み。加えて `docs/sources/` は `.prettierignore` に入れてある。

### 4. base path を 1 箇所に閉じる

`src/config/site.mjs` の `SITE_BASE` だけが `/study-mapf/` を知っている。
アプリ側は `src/lib/paths.ts` の `withBase()` / `assetUrl()` を使う。

**理由**: プロジェクトサイトなので base path が付く。文字列を散らすと必ずどこかで壊れる。
E2E で `/study-mapf/` 配下のアセットが 4xx にならないことを検査している。

### 5. アルゴリズムのロジックと描画を分離する

`src/lib/render/renderer.ts` は Solver の内部状態を知らない。
渡された「今の見た目」だけを描く。アニメーションは `SolverEvent` か保存済みフレームから再生する。

**理由**: 後から CBS・PIBT・LNS を足したとき、描画コードを触らずに可視化できるようにするため。
`SolverEvent` に `add-constraint` / `inherit-priority` / `destroy-neighborhood` を
最初から入れてあるのはこのため。

### 6. 探索を Web Worker で動かす

`src/solvers/worker.ts` が Solver を実行し、`postMessage` で結果とイベントを返す。

**理由**: UI スレッドを止めない。`expand-node` は数万件出るので、
Worker 側でバッチ化・間引きしてから送る（全部送ると UI が追いつかない）。

Worker が使えない環境（テスト、SSR）では `runInline()` へフォールバックする。同じ API のまま。

### 7. 実装状態を registry から決める

`AlgorithmStatus` コンポーネントは `algorithms.yaml` の宣言ではなく、
`src/solvers/registry.ts` に**実際に登録されている Solver** を見る。

**理由**: 「解説がある」と「動く」を混同させないことが、この教材で最も重要な要件のため。
宣言だけを信じると、YAML の書き間違いがそのまま「実行可」の誤表示になる。

### 8. 分類 ID とアルゴリズム ID の名前空間を分ける

分類ページは `/algorithms/category/<id>/`、手法ページは `/algorithms/<id>/`。

**理由**: どちらにも `cbs` があり、同じ名前空間に置くとルートが衝突する。

### 9. シミュレータは `client:only`

**理由**: Canvas と `localStorage` を使うので SSR しても意味が無く、
ハイドレーションの不一致を招く。解説本文は静的に出しているので、
JS 無効でもページの情報は失われない（`<noscript>` で案内する）。

### 10. 色だけでエージェントを識別させない

Canvas は色に加えて**形**（円・四角・ひし形・三角）と**番号**を描く。
さらに盤面の状態を `.sim-desc`（`aria-live`）に文章で出す。

**理由**: 色覚特性、白黒印刷、スクリーンリーダーのいずれでも読めるようにするため。

---

## ディレクトリ

| パス                        | 内容                                                   |
| --------------------------- | ------------------------------------------------------ |
| `src/config/site.mjs`       | site / base / タイトル。**base path の唯一の定義箇所** |
| `src/lib/paths.ts`          | `withBase` / `assetUrl` / `absoluteUrl`                |
| `src/lib/manifest.ts`       | マニフェストの読み込みと型                             |
| `src/lib/nav.ts`            | ナビゲーション定義                                     |
| `src/lib/model/`            | ドメインモデル。UI にも Worker にも依存しない          |
| `src/lib/render/`           | Canvas 描画。ロジックに依存しない                      |
| `src/solvers/`              | Solver 実装、registry、Worker                          |
| `src/components/sources/`   | 出典表示（8 種）                                       |
| `src/components/simulator/` | シミュレータ UI（React island）                        |
| `src/content/algorithms/`   | 解説本文（MDX）                                        |
| `src/layouts/`              | `BaseLayout` / `AlgorithmLayout`                       |
| `src/pages/`                | ルーティング                                           |
| `src/styles/`               | デザイントークンとグローバル CSS                       |
| `tests/unit/`               | Vitest                                                 |
| `tests/e2e/`                | Playwright                                             |

---

## データフローの要点

### 解説ページが表示されるまで

1. `src/content.config.ts` が `src/content/algorithms/*.mdx` を読む（Astro 7 の content layer）
2. `src/pages/algorithms/[...slug].astro` が `getStaticPaths` で全ページを生成
3. `AlgorithmLayout` が frontmatter の `algorithmId` で `algorithms.yaml` を引く
4. 実装状態は `registry` から、保証は `algorithms.yaml` から、出典は `papers.yaml` から取る
5. 本文（MDX）は `<slot />` に入る

frontmatter に出典が無い場合は `algorithms.yaml` の `primary_paper_ids` にフォールバックする。

### シミュレータが解を出すまで

1. `Simulator.tsx` がシナリオを組み立てる（プリセット / 編集 / JSON import）
2. `runSolver()` が Worker へ `solve` を送る
3. Worker が `registry` から Solver を引き、`SolverContext` を作って実行
4. Solver は `context.emit()` でイベントを流す（Worker がバッチ化して返す）
5. `SolverResult` を受け取り、`positionAt()` で時刻ごとの位置を計算して描画

**Solver は `Math.random()` を使わない。** `context.random()` は seed から作られるので、
同じ seed と同じ入力なら結果が一致する。テストで検証している。

---

## 既知の制約

- MAPD に対応した Solver は未実装。タスクの編集と JSON 保存はできるが実行できない
- Moving AI の `.map` / `.scen` はパーサだけ実装済み。シミュレータ UI からの読み込みは JSON のみ
- 予約表・制約のレイヤは描画側に口があるが、現状 UI から可視化していない
- 時空間 A* の open list は配列 + 線形探索。教材規模では十分だが大規模では遅い
