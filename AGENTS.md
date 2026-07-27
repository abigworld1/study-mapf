# AGENTS.md — Claude Code / Codex 共通の作業規約

このファイルは **Codex が `AGENTS.md` を、Claude Code が `CLAUDE.md` を自動で読む** という
違いを吸収するための単一の情報源である。`CLAUDE.md` はこのファイルを指すだけの薄いポインタで、
規約の実体はここにしか書かない。二重管理しないこと。

このリポジトリは MAPF / Lifelong MAPF / MAPD の教育サイトを作る。
**現段階は資料整備フェーズであり、サイト本体は 1 行も実装されていない。**

---

## 0. 最初に読むもの

| ファイル                                       | 内容                                 |
| ---------------------------------------------- | ------------------------------------ |
| [SOURCE_POLICY.md](SOURCE_POLICY.md)           | 資料の取り扱い規約 12 条。**最重要** |
| [SOURCE_ACQUISITION.md](SOURCE_ACQUISITION.md) | 論文 PDF の取得一覧と手順            |
| [docs/README.md](docs/README.md)               | マニフェスト 3 種の関係と分類        |
| [WORKLOG.md](WORKLOG.md)                       | 実施済みの作業と未解決事項           |

`docs/sources/*.yaml` が単一の情報源である。
論文・実装・アルゴリズムの情報を本文へ書く前に、必ずここを見る。

---

## 1. 事実の出所に関する規約

**このリポジトリで最も守るべき規約は「知らないことを書かない」である。**

- 論文のタイトル・著者・年・会議・DOI・URL を **記憶から書かない**。
  `docs/sources/papers.yaml` に無い情報が必要になったら、
  検索して一次情報（出版社のメタタグ、CrossRef、PDF 本文）で確認してから追記する。
- URL を推測して書かない。`arxiv.org/abs/XXXX.XXXXX` の ID を当てずっぽうで書くと、
  高い確率で全く別の論文になる（本リポジトリ整備中に実際に起きた）。
  必ず取得して 200 と `Content-Type: application/pdf` を確認する。
- 理論保証（完全性・最適性・有界準最適性）を推測しない。
  原論文で確認できないものは `unknown` のままにする。SOURCE_POLICY.md 第 7・8 条。
- ライセンスを GitHub の表示だけで判断しない。実ファイルを読む。第 10 条。

新しい事実を `docs/sources/*.yaml` へ足すときの検証手段。

```bash
# URL が生きているか + 本当に PDF か
curl -sSL -o /dev/null -w "%{http_code} %{content_type}\n" "<URL>"

# PDF の 1 ページ目が想定の論文か
pdftotext -f 1 -l 1 -q paper.pdf - | head -5

# DOI が本当にその論文か（CrossRef）
curl -sS "https://api.crossref.org/works/<DOI>" | head -c 400

# 出版社ページの citation メタタグ
curl -sSL --compressed "<landing_url>" | grep -oE '<meta name="citation_[a-z_]+" content="[^"]*"'
```

---

## 2. 禁止事項

次の操作はしない。

- `git reset --hard`
- `git clean -fd`
- force push（`git push --force` / `--force-with-lease`）
- remote URL の変更（`origin` は `https://github.com/abigworld1/study-mapf.git` で固定）
- ユーザが作成したファイルの削除
- ライセンス不明コードのコピー
- URL や論文情報の推測による捏造

`.references/` 配下のディレクトリを削除しない。
`sync-reference-repos.sh` も既存 clone を削除せず `fetch` のみ行う設計になっている。

---

## 3. ファイルの置き場所

| 置くもの           | 場所                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| 原論文 PDF         | `docs/papers/<paper-id>/paper.pdf`（`.gitignore` 済み）                 |
| Marker Markdown    | `docs/papers/<paper-id>/marker.md`                                      |
| 論文ごとの読解記録 | `docs/papers/<paper-id>/metadata.yaml`                                  |
| 手法ごとの読解メモ | `docs/notes/<algorithm-id>.md`                                          |
| マニフェスト       | `docs/sources/*.yaml`                                                   |
| 第三者リポジトリ   | `.references/<repository-id>/`（`.gitignore` 済み。**コミットしない**） |
| スクリプト         | `scripts/`                                                              |

`docs/sources/schema/*.schema.json` を変更したら、
`scripts/lib/mini-schema.mjs` が対応しているキーワードかを確認すること。
未対応のキーワードを使うとバリデータが明示的に error を出す（黙って素通りはしない）。

---

## 4. 作業前後に必ず走らせるもの

```bash
node scripts/validate-sources.mjs
```

`errors=0` であること。マニフェストを触ったら必ず実行する。
`--strict` を付けると warning も失敗扱いになる。

未取得資料の確認。

```bash
node scripts/print-missing-sources.mjs                 # 論文
node scripts/print-missing-sources.mjs --priority P0
node scripts/print-missing-sources.mjs --repos         # 参照実装
node scripts/print-missing-sources.mjs --marker-meta   # marker_meta.json が無い論文
```

marker.md が PDF をどれだけ正しく写せているかの機械照合。

```bash
node scripts/check-marker-fidelity.mjs                # 全 52 本
node scripts/check-marker-fidelity.mjs cbs-aaai-2012  # ID 指定
node scripts/check-marker-fidelity.mjs --write        # metadata.yaml の machine_index を更新
```

**このスクリプトは人手の目視照合の代替ではない。** 丸ごと落ちた Algorithm / Theorem /
Figure / Table と、語数の大幅な目減りしか検出できない。数式の中身が正しいかは判定していない。
`status: verified` にするには人の目で PDF と突き合わせること（SOURCE_POLICY.md 第 5・6 条）。

参照実装の更新。

```bash
scripts/sync-reference-repos.sh              # 全件
scripts/sync-reference-repos.sh pibt2 lacam3 # ID 指定
DRY_RUN=1 scripts/sync-reference-repos.sh    # 対象確認のみ
```

---

## 5. 依存関係

**Node.js 標準機能のみで動く。`npm install` は不要。**

YAML パーサ（`scripts/lib/mini-yaml.mjs`）と JSON Schema 検証器
（`scripts/lib/mini-schema.mjs`）は自作のサブセット実装である。
使える YAML はマニフェストで実際に使っている範囲に限られる。

- 対応: ブロックマッピング、ブロックシーケンス、1 行のフローシーケンス `[a, b]`、
  引用符つき/なしスカラ、`null` / `~` / 真偽値 / 整数、コメント
- 非対応: アンカー、エイリアス、マージキー、複数行ブロックスカラ（`|` / `>`）、フローマッピング `{}`

非対応の構文は黙って無視せず例外を投げる。
複数行の文章を書きたい場合は、1 行の引用文字列にするか `notes` を分割すること。

外部ライブラリを足す判断は、まずユーザに確認する。

---

## 6. 次工程（サイト実装）に入るときの前提

**今はまだサイトを実装しない。** 実装フェーズへ移るときは次を確認する。

1. P0 の 9 本が `marker-ready` 以上になっている
2. `algorithms.yaml` の P0 相当の手法から `unknown` の保証が消えている
3. サイトへ載せる PDF が `redistribution.status: allowed` のものだけになっている

サイト実装時の資料の使い方。

- 手法の定義・擬似コード・保証 → `docs/papers/<id>/paper.pdf` を根拠にする。
  `marker.md` は検索用であって根拠ではない（SOURCE_POLICY.md 第 5 条）。
- 実装の細部（タイブレーク、初期化）→ `.references/` を読む。
  ただし `copy_allowed: true` 以外からは転記しない（第 9・10 条）。
- 論文と実装が食い違ったら両方書く（第 4 条）。
- 図表は貼らず、描き直して「〜を参考に作図」と注記する（第 11 条）。

---

## 7. Claude Code と Codex で分担するときの申し送り

- 片方が `docs/sources/*.yaml` を編集したら、もう片方は作業前に必ず読み直す。
  マニフェストは 3 ファイルとも相互参照しているため、部分的な知識で編集すると壊れる。
- `WORKLOG.md` に追記する。日付・担当（Claude Code / Codex / ユーザ）・
  変更したファイル・未解決事項を書く。
- 検証されていない情報を入れるときは、値を入れずに
  `notes` へ「要調査」と書く。空欄や `null` のほうが、間違った値より安全である。
- `git commit` はユーザの指示があるときだけ行う。`main` へ直接コミットする前に必ず確認する。
