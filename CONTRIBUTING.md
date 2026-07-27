# CONTRIBUTING.md — 変更の進め方

## 最初に読むもの

| 目的                         | 文書                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| 全体像・セットアップ         | [README.md](README.md)                                                 |
| 資料の扱い（最重要）         | [SOURCE_POLICY.md](SOURCE_POLICY.md)                                   |
| 作業規約（エージェント含む） | [AGENTS.md](AGENTS.md)                                                 |
| サイトの設計                 | [ARCHITECTURE.md](ARCHITECTURE.md)                                     |
| 解説を書く                   | [CONTENT_GUIDE.md](CONTENT_GUIDE.md)                                   |
| Solver を足す                | [ALGORITHM_IMPLEMENTATION_GUIDE.md](ALGORITHM_IMPLEMENTATION_GUIDE.md) |

---

## 変更前に

```bash
npm ci
npm run sources:validate   # errors=0 であること
npm test
```

`sources:validate` が通らない状態で始めない。マニフェストが壊れているとサイトが生成できない。

## 変更後に（品質ゲート）

全部通ってから PR を出す。CI と同じ内容。

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e        # 可能なら
```

---

## 禁止事項

### Git

- `git reset --hard`
- `git clean -fd`
- force push
- remote URL の変更（`origin` は `https://github.com/abigworld1/study-mapf.git` で固定）
- ユーザが作成したファイルの削除

### 内容

- **論文情報・URL・DOI を記憶や推測で書く。** 必ず一次情報で確認する
- **原論文にない理論保証を書く。** 確認できないものは `unknown`
- **確認していないページ番号を書く。** 省略する
- **資料が足りないページをもっともらしい文章で埋める。** `<PreparingNotice />` を出す
- **`copy_allowed: true` 以外のリポジトリからコードを転記する**
- **再配布可否が `allowed` でない PDF をサイトへ同梱する**

### コード

- `Math.random()` / `Date.now()` を Solver 内で使う（決定性が壊れる）
- `/study-mapf/` を文字列で書く（`withBase()` を使う）
- 実装していないアルゴリズムを `registry` に登録する
- `docs/sources/*.yaml` と同じ情報をページ側へ手書きする

---

## よくある作業

### 論文を追加する

1. `docs/sources/papers.yaml` へ追加。URL は curl で 200 と `application/pdf` を確認、DOI は CrossRef で照合
2. PDF を `docs/papers/<paper-id>/paper.pdf` へ置く
3. Marker で変換して `marker.md` / `images/` を配置
4. `npm run sources:validate`
5. `node scripts/check-marker-fidelity.mjs <paper-id> --write` で機械照合

### 手法を追加する

1. `docs/sources/algorithms.yaml` へ追加。**保証は確認できたものだけ**書き、根拠を `guarantee_evidence` に原文で入れる
2. `src/content/algorithms/<id>.mdx` を作る（[CONTENT_GUIDE.md](CONTENT_GUIDE.md)）
3. 実装するなら `src/solvers/` と `registry.ts`（[ALGORITHM_IMPLEMENTATION_GUIDE.md](ALGORITHM_IMPLEMENTATION_GUIDE.md)）

### 依存を追加する

`README.md` の技術構成の表に**理由**を書く。書けないなら足さない。

---

## Prettier と YAML

`docs/sources/` は `.prettierignore` に入れている。

**理由**: 一度 Prettier が `authors: [...]` を複数行へ折り返し、
自作 YAML パーサが読めなくなってマニフェストが全滅した。
パーサ側も複数行フローに対応させたが、差分を安定させるため整形対象から外している。

`docs/papers/` `docs/output*/` も除外している。原文と行番号の対応を壊さないため。

---

## テストの方針

| 種類     | 場所                            | 内容                                                      |
| -------- | ------------------------------- | --------------------------------------------------------- |
| ユニット | `tests/unit/`                   | グリッド座標、衝突判定、予約表、パーサ、Solver            |
| 反復     | `tests/unit/invariants.test.ts` | seed を変えて多数のインスタンスを解き、解の不変条件を検査 |
| E2E      | `tests/e2e/`                    | ページ遷移、シミュレータ操作、base path、アクセシビリティ |

新しい Solver を足したら、最低限これを書く。

- `solved` を返したとき衝突が 0 件
- 同じ seed と同じ入力で結果が一致する
- 到達不能なインスタンスで `no-solution`

`tests/unit/invariants.test.ts` の `checkPaths()` を再利用すると、
壁通過・跳躍・衝突・ゴール未到達をまとめて検査できる。

---

## コミットとブランチ

- `main` へ直接コミットしない。ブランチを切る
- コミットは 1 つの意味的なまとまりごとに
- `WORKLOG.md` に日付・担当・変更ファイル・未解決事項を追記する

## PR に書くこと

- 何を変えたか
- なぜ変えたか
- 品質ゲートが通ったか
- **新しく書いた解説について、どこまで原論文で確認したか**
- 未解決のまま残したこと
