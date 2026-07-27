# study-mapf

Multi-Agent Path Finding（MAPF）、Lifelong MAPF、Multi-Agent Pickup and Delivery（MAPD）を、
**原論文に基づいて**学ぶための教材サイト。

公開先: <https://abigworld1.github.io/study-mapf/>

このリポジトリは 2 つの層でできている。

| 層           | 内容                                               | 場所              |
| ------------ | -------------------------------------------------- | ----------------- |
| 資料コーパス | 原論文 PDF、Marker 変換 Markdown、出典マニフェスト | `docs/`           |
| サイト       | Astro による静的サイト、シミュレータ               | `src/`, `public/` |

`docs/` は**サイトの公開ディレクトリではない**。原論文を管理するためのローカルコーパスである。

---

## 技術構成

| 技術                          | バージョン         | 採用理由                                                                              |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| [Astro](https://astro.build/) | 7.1.x              | 静的生成が既定。必要な箇所だけ JS を送る islands 方式で、解説本文は JS 無効でも読める |
| TypeScript                    | 5.9.x              | strict モード。`noUncheckedIndexedAccess` も有効                                      |
| React                         | 19.x               | シミュレータの UI だけに使う（island）。サイト全体を React にはしない                 |
| MDX                           | `@astrojs/mdx` 7.x | 解説本文に出典コンポーネントを埋め込むため                                            |
| KaTeX                         | 0.18.x             | 数式。CDN を使わず `node_modules` から同梱するのでオフラインでもビルドできる          |
| Canvas 2D                     | —                  | グリッド描画。DOM より軽く、レイヤ構成を自前で制御できる                              |
| Web Workers                   | —                  | 探索で UI スレッドを止めないため                                                      |
| Vitest                        | 4.1.x              | ユニット・反復テスト                                                                  |
| Playwright                    | 1.62.x             | E2E。`/study-mapf/` 配下で本番と同じ条件を確認する                                    |
| ESLint                        | 9.39.x             | ESLint 10 系は `eslint-plugin-jsx-a11y` の peer が未対応のため 9 系で固定             |
| Prettier                      | 3.9.x              | —                                                                                     |

**巨大な UI フレームワークは入れていない。** スタイルは CSS Variables と小さなコンポーネントで組む。

### 依存を足すときは

`README.md` のこの表に**理由**を書く。「便利だから」では足さない。
特に、以下は避ける。

- CSS フレームワーク全般（デザイントークンで足りる）
- 状態管理ライブラリ（シミュレータの状態は `useState` で足りる規模）
- YAML パーサ（`scripts/lib/mini-yaml.mjs` を使う。バリデータと同じ解釈にするため）

---

## セットアップ

```bash
node --version   # 22.12.0 以上（astro 7 の要件）
npm ci
```

## 開発サーバー

```bash
npm run dev      # http://localhost:4321/study-mapf/
```

base path が付くので、ルートではなく `/study-mapf/` を開く。

## テスト

```bash
npm test              # ユニット + 反復テスト（Vitest）
npm run test:watch
npm run test:e2e      # E2E（Playwright）。build して preview を立ててから実行する
```

E2E を初めて動かすときはブラウザの取得が要る。

```bash
npx playwright install chromium
```

## ビルド

```bash
npm run build         # astro check（型検査）+ ビルド
npm run build:only    # ビルドのみ
npm run preview       # dist/ を配信して確認
```

出力は `dist/`。

## 品質ゲート

CI と同じものをローカルで回せる。

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

資料マニフェストの検査も忘れずに。

```bash
npm run sources:validate     # errors=0 であること
npm run sources:missing      # 未取得の資料
npm run sources:fidelity     # marker.md と PDF の機械照合
```

---

## GitHub Pages デプロイ

`main` へ push すると `.github/workflows/deploy.yml` が動く。
公式の Pages Actions（`configure-pages` / `upload-pages-artifact` / `deploy-pages`）を使い、
`gh-pages` ブランチは作らない。

リポジトリ設定で **Settings → Pages → Source を "GitHub Actions"** にしておく必要がある。

### base path の扱い

**プロジェクトサイト**なので、URL は `https://abigworld1.github.io/study-mapf/` になる。

```
site = https://abigworld1.github.io     ← オリジンのみ
base = /study-mapf/                     ← サブパス
```

この 2 つは `src/config/site.mjs` の 1 箇所だけで定義している。

**`/study-mapf/` を文字列で書かないこと。** 参照は必ず次を通す。

```ts
import { withBase, assetUrl, absoluteUrl } from "@/lib/paths";

withBase("/algorithms/cbs/"); // → /study-mapf/algorithms/cbs/
assetUrl("/favicon.svg"); // → /study-mapf/favicon.svg
```

これらは `import.meta.env.BASE_URL` を読むので、dev / preview / 本番のどれでも正しく解決される。
Worker も `new Worker(new URL("./worker.ts", import.meta.url))` で Vite に解決させており、
パスを組み立てていない。

E2E は `baseURL` に `/study-mapf/` を含めて本番と同じ条件で検証する。

---

## `docs/` 資料の役割

```
docs/
├── papers/<paper-id>/
│   ├── paper.pdf          原論文（.gitignore 済み。再配布可のものだけ git add -f）
│   ├── marker.md          Marker 変換 Markdown
│   ├── metadata.yaml      取得記録・読解記録・機械照合の結果
│   └── images/            抽出画像
└── sources/
    ├── papers.yaml        原論文 52 本
    ├── repositories.yaml  参照実装 24 件
    ├── algorithms.yaml    手法 77 件
    └── schema/            上記の JSON Schema
```

**`docs/sources/*.yaml` がサイトの単一情報源。** ナビゲーション、アルゴリズム一覧、比較表、
出典表示はすべてここから生成する。同じ情報を複数箇所へ手書きしない。

サイトからの読み込みは `src/lib/manifest.ts`。ビルド時に `?raw` で YAML を埋め込んでパースする
（`fs.readFileSync` は使えない。prerender 時に出力先を指してしまうため）。

### PDF の扱い

`papers.yaml` の `redistribution.status` が `allowed` のものだけサイトに同梱してよい。
それ以外は外部リンクのみ。詳細は [SOURCE_POLICY.md](SOURCE_POLICY.md) 第 12 条。

**Marker Markdown をそのまま公開ページにしない。** 資料として参照し、
初学者向けに再構成した独自解説を書く。

## `.references/` の役割

第三者の公開実装を clone する場所（`.gitignore` 済み）。挙動確認とテストケース作成にのみ使う。

```bash
scripts/sync-reference-repos.sh
node scripts/print-missing-sources.mjs --repos
```

**コードを転記してよいのは `copy_allowed: true` の 10 件（MIT）だけ。**
ライセンスは GitHub の自動判定ではなく実ファイルで判定している。
自動判定が MIT でも実体が非営利限定の独自ライセンスだった例がある。

---

## 新しい論文の追加方法

1. `docs/sources/papers.yaml` へエントリを足す。
   **タイトル・著者・年・会議・DOI・URL は一次情報で確認してから書く。** 記憶や推測で書かない
2. URL は実際に取得して `200` かつ `application/pdf` を確認する
3. DOI は CrossRef で照合する

```bash
curl -sSL -o /dev/null -w "%{http_code} %{content_type}\n" "<URL>"
curl -sS "https://api.crossref.org/works/<DOI>" | head -c 400
```

4. PDF を `docs/papers/<paper-id>/paper.pdf` へ置き、`status` を `pdf-ready` にする
5. Marker で変換し、`marker.md` / `images/` を配置して `marker-ready` にする
6. `npm run sources:validate` が `errors=0` で通ることを確認する

詳細は [SOURCE_ACQUISITION.md](SOURCE_ACQUISITION.md)。

## 新しいアルゴリズムの追加方法

解説ページと実装は別物なので、分けて考える。

- **解説ページ** → [CONTENT_GUIDE.md](CONTENT_GUIDE.md)
- **シミュレータの実装** → [ALGORITHM_IMPLEMENTATION_GUIDE.md](ALGORITHM_IMPLEMENTATION_GUIDE.md)

## Solver API

```ts
interface MapfSolver {
  readonly metadata: SolverMetadata;
  solve(scenario: Scenario, options: SolverOptions, context: SolverContext): Promise<SolverResult>;
}
```

`src/solvers/registry.ts` の `SOLVERS` に追加すれば、シミュレータの選択肢、
アルゴリズムページのバッジ、比較表の「シミュレータ対応」列が自動で更新される。

**実装していないアルゴリズムを registry に登録してはならない。**
選択肢に出ること自体が「動く」という意味になるため。

守るべき点は次のとおり。

- `AbortSignal` に対応する
- `context.random()` を使う（`Math.random()` は禁止。決定性が壊れる）
- `context.now()` を使ってタイムアウトを見る
- 展開上限を超えたら `outcome: "node-limit"` を返す
- 例外を投げず、`outcome` と `error` で構造化して返す
- 同じ seed と同じ入力なら同じ結果になること

詳細は [ALGORITHM_IMPLEMENTATION_GUIDE.md](ALGORITHM_IMPLEMENTATION_GUIDE.md)。

## 出典の書き方

本文中はこの形式。

```mdx
<SourceCitation paperId="cbs-aij-2015" section="5.1" label="Theorem 1" page={12} />
```

→ `[cbs-aij-2015, §5.1, Theorem 1, p.12]`

**節番号・ページ番号は確認できたものだけ書く。** 確認できていない項目は省略する。
Marker Markdown の見出し位置からページ番号を推測してはならない。

MDX の frontmatter でも出典を持つ。

```yaml
title: "CBS"
algorithmId: cbs
originalName: "Conflict-Based Search"
status: draft # draft | reviewed | verified
primarySources:
  - paperId: cbs-aij-2015
    sections: ["5.1"]
    pages: [12]
implementationReferences:
  - repositoryId: libmultirobotplanning
lastReviewed: "2026-07-27"
```

---

## ライセンス注意事項

- **論文 PDF**: 再配布が許諾されているものを除きサイトへ同梱しない。配布元へリンクする
- **第三者コード**: `copy_allowed: true` 以外からは 1 行も転記しない。非寛容ライセンスのものは独立に再実装する
- **ベンチマーク**: Moving AI のマップ・シナリオは同梱しない。配布元から取得する
- **本リポジトリのコード**: ライセンス未定。決めるまで再利用は想定しない

規約の全文は [SOURCE_POLICY.md](SOURCE_POLICY.md)。

---

## ドキュメント

| ファイル                                                               | 内容                               |
| ---------------------------------------------------------------------- | ---------------------------------- |
| [AGENTS.md](AGENTS.md)                                                 | Claude Code / Codex 共通の作業規約 |
| [SOURCE_POLICY.md](SOURCE_POLICY.md)                                   | 資料の取り扱い規約 12 条           |
| [SOURCE_ACQUISITION.md](SOURCE_ACQUISITION.md)                         | 論文の取得状況と照合手順           |
| [ARCHITECTURE.md](ARCHITECTURE.md)                                     | サイトの構造と設計判断             |
| [CONTENT_GUIDE.md](CONTENT_GUIDE.md)                                   | 解説ページの書き方                 |
| [ALGORITHM_IMPLEMENTATION_GUIDE.md](ALGORITHM_IMPLEMENTATION_GUIDE.md) | Solver の追加方法                  |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                     | 変更の進め方                       |
| [WORKLOG.md](WORKLOG.md)                                               | 作業記録                           |
