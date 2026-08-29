# WORKLOG.md

MAPF / Lifelong MAPF / MAPD 教育サイトの作業記録。
新しい作業をしたら、日付・担当（ユーザ / Claude Code / Codex）・変更ファイル・未解決事項を追記すること。

---

## 2026-07-26 — 資料管理基盤の構築（担当: Claude Code）

サイト本体は実装していない。資料の置き場所、マニフェスト、取得手順、作業規約の整備のみ。

### 最初に行った環境確認

```text
$ cd /home/hirayama/study-mapf && pwd
/home/hirayama/study-mapf

$ git status
On branch main
No commits yet
nothing to commit (create/copy files and use "git add" to track)

$ git remote -v
origin	https://github.com/abigworld1/study-mapf.git (fetch)
origin	https://github.com/abigworld1/study-mapf.git (push)

$ git branch --show-current
main
```

- **remote は指定どおり `abigworld1/study-mapf` であることを確認した。** 変更していない。
- 開始時点でコミットは 0 件、`.git` 以外は空だった。
- ネットワークは利用可能（github.com / arxiv.org ともに HTTP 200）。
- 環境: Node.js v22.21.1、git 2.43.0、`pdftotext` / `pdfinfo` 利用可。

禁止操作（`git reset --hard` / `git clean -fd` / force push / remote URL 変更 /
ユーザ作成ファイルの削除 / ライセンス不明コードのコピー / 情報の捏造）はいずれも行っていない。
`git commit` も行っていない（指示が無いため作業ツリーに置いたまま）。

### 作成したもの

```text
study-mapf/
├── AGENTS.md                      作業規約の実体（Codex が読む）
├── CLAUDE.md                      AGENTS.md へのポインタ（Claude Code が読む）
├── SOURCE_POLICY.md               資料取り扱い規約 12 条
├── SOURCE_ACQUISITION.md          PDF 取得一覧（52 本、優先度別の表）
├── WORKLOG.md                     このファイル
├── .gitignore                     .references/ と docs/papers/**/*.pdf を除外
├── docs/
│   ├── README.md
│   ├── papers/<paper-id>/         52 ディレクトリ。metadata.yaml 雛形 + images/ を配置済み
│   ├── sources/
│   │   ├── papers.yaml            論文 52 本
│   │   ├── repositories.yaml      参照実装 24 件
│   │   ├── algorithms.yaml        アルゴリズム 77 件
│   │   └── schema/*.schema.json   3 ファイル
│   └── notes/                     （空）
├── scripts/
│   ├── sync-reference-repos.sh
│   ├── validate-sources.mjs
│   ├── print-missing-sources.mjs
│   └── lib/
│       ├── mini-yaml.mjs          依存ゼロの YAML サブセットパーサ
│       ├── mini-schema.mjs        依存ゼロの JSON Schema サブセット検証器
│       └── repo-targets.mjs       repositories.yaml → TSV（sync スクリプト用）
└── .references/                   24 リポジトリを clone（.gitignore 済み、370MB）
```

指定された構造からの追加は `scripts/lib/`（3 ファイル）、`AGENTS.md`、`CLAUDE.md` の 3 点。
`scripts/lib/` は「Node.js 標準機能と少数の依存関係だけで実装」という要件を満たすために、
YAML パーサと JSON Schema 検証器を自作した結果である（`npm install` 不要）。

### 調査結果

#### 論文 52 本

初期リストの 33 本に加え、以下 19 本を調査の過程で追加した。

| 追加した論文                                                  | 追加理由                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `astar-1968` / `dijkstra-1959`                                | 「追加調査対象」の A* / Dijkstra の原典として                                             |
| `standley-od-id-2010`                                         | Operator Decomposition と Independence Detection の原典                                   |
| `cbs-aaai-2012`                                               | `cbs-aij-2015` が購読制のため、無料で入手できる会議版を代替として                         |
| `ma-cbs-socs-2012`                                            | MA-CBS の原典                                                                             |
| `cbsh-icaps-2018` / `cbsh2-ijcai-2019` / `cbsh2-rtc-aij-2021` | CBSH / CBSH2 / CBSH2-RTC・矩形/回廊/目標対称性推論の原典                                  |
| `disjoint-splitting-icaps-2019`                               | Disjoint Splitting の原典                                                                 |
| `bcp-ijcai-2019` / `mdd-sat-ecai-2016` / `smt-cbs-ijcai-2019` | BCP / MDD-SAT / SMT-CBS の原典                                                            |
| `sippwrt-aaai-2019`                                           | SIPPwRT の原典                                                                            |
| `ita-cbs-mrs-2023` / `ita-ecbs-socs-2024`                     | ITA-CBS / ITA-ECBS の原典                                                                 |
| `ml-lns-aaai-2022`                                            | MAPF-ML-LNS の原典                                                                        |
| `auction-algorithm-1988` / `network-flow-mapf-2012`           | Auction Algorithm / Min-Cost Max-Flow の原典                                              |
| `lns-reevaluation-socs-2025`                                  | `.references/mapf-lns-unified` の README が対応論文として掲げていたため（clone 後に判明） |

**全 52 本について次を検証した。**

- 全 URL を `curl` で取得し、HTTP ステータスと `Content-Type` を確認
- 直リンク PDF 44 本は `pdftotext` で 1 ページ目を抽出し、タイトル・著者を照合
- 記録した DOI 33 件は CrossRef API でタイトル・巻号・ページを照合
- arXiv 16 本はライセンス表示を abs ページから取得（既定ライセンスか CC か）
- 主要な会議 PDF は本文中の著作権表示を抽出（AAAI/SoCS/AIIDE は "All rights reserved"、
  AAMAS 2024 は CC BY 4.0、IFAAMAS 2013 は IFAAMAS 著作権）

**ユーザ提示 URL から差し替えたもの。**

| 論文                          | 提示 URL の問題                                         | 差し替え先                                   |
| ----------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| Cooperative Pathfinding       | `davidsilver.uk/...coop-path-AIIDE.pdf` が **404**      | AAAI 公式 OJS の galley 直リンク             |
| Subdimensional Expansion (M*) | `kilthub.cmu.edu/ndownloader/files/12043325` が **403** | CMU Biorobotics Lab の著者版                 |
| BCBS/ECBS、LaCAM、MAPF-LNS2   | ランディングページで PDF ではない                       | `citation_pdf_url` の galley 直リンク        |
| ICTS                          | 提示 URL は個人ページ（内容は正しい IJCAI 2011 版）     | IJCAI 公式 URL を主、個人ページを代替に      |
| CBS (AIJ)                     | DOI は Elsevier ランディングのみ、公開 PDF なし         | `link-only` として記録し、会議版を代替に追加 |

#### 参照実装 24 件（clone 成功 24 / 失敗 0 / 未実行 0）

初期候補 21 件のうち 2 件は移転していた。

- `ChristinaTan0704/mapf-lns-benchmark` → **`ChristinaTan0704/mapf-lns-unified`**（GitHub API の 301 で確認）
- `nathansttt/hog2` → **`MovingAILab/hog2`**（同上。初期リストには無かったが有用なので追加）

さらに `Jiaoyang-Li/CBSH2` と `Jiaoyang-Li/CBSH2-RTC` を追加した（CBSH2 / 対称性推論の実装として必要）。

**ライセンスは GitHub API の自動判定ではなく、clone 後に実ファイルを読んで判定した。**
この結果、API の表示と実態が食い違うものが 2 系統見つかった。

1. **USC 系 7 件**（`pbs` / `eecbs` / `rhcr` / `mapf-lns` / `mapf-lns2` / `cbsh2` / `cbsh2-rtc`）
   API は `NOASSERTION` を返すのみだが、実体は南カリフォルニア大学の独自ライセンス。
   「教育・研究・非営利目的に限り、著作権表示の保持を条件として利用・複製・改変・配布を許諾」
   「商用利用は USC Stevens Center への個別連絡が必要」。
   → `license_spdx: NOASSERTION` / `copy_allowed: false`（独立再実装する）
2. **`primal` / `primal2`**
   API は `MIT` と判定するが、`LICENSE.md` の著作権者が `.NET Foundation and Contributors` に
   なっており、当該プロジェクトの権利者と一致しない。定型文の混入と見られる。
   → `license_spdx: MIT` だが `copy_allowed: false`（転記が必要なら著者へ要確認）

ライセンスファイルが存在しないのは 5 件（`push-and-rotate-cbs-pp` / `public-cppmomapf` /
`mapf-icbs` / `mapf-lns-unified` / `awesome-mapf`）。いずれも `copy_allowed: false`。

`relation` の内訳: `official` 10 / `author-maintained` 9 / `research-reference` 3 / `third-party` 2。
`official` は README の論文引用、または LICENSE の著作権者名が原論文著者と一致することを根拠にした。
検索で見つけただけのものは `third-party` にしてある。

サブモジュールは要件どおり取得していない。
`lacam0` / `lacam2` / `lacam3` / `pibt2` / `mapf-visualizer` / `mapf-lns-unified` の 6 件が
サブモジュールを持つため、そのままではビルドできない。
特に `mapf-lns-unified` は `git@github.com:` 形式の SSH サブモジュールを含み、
SSH 鍵なしでは取得できない（サブモジュールを取らない判断が正しかったことの裏づけ）。

#### アルゴリズム 77 件

指定された 14 分類すべてにエントリがある。
「追加調査対象」に挙がっていた 33 手法はすべて登録済み。

理論保証は **71 件が `unknown` を含む**。PDF が 1 本も手元に無いため、
タイトルとアブストラクトで確認できた範囲だけを埋め、残りは意図的に `unknown` にしてある。
根拠が取れたものには `guarantee_evidence` に原文を引用してある（例: CCBS の
「is complete, and provides provably optimal solutions」、CBS-TA の「is complete and optimal」）。

### 検証

```bash
$ node scripts/validate-sources.mjs
=== validate-sources.mjs 集計 ===
papers        : 52 件  (missing=52, pdf-ready=0, marker-ready=0, verified=0)
repositories  : 24 件
algorithms    : 77 件
保証が unknown : 71 件のアルゴリズム
errors=0 warnings=1
```

残る warning 1 件は `bfs` がどの論文からも参照されていないというもので、
BFS の原典（Moore 1959）を特定できなかったことの正しい反映であるため、握りつぶさず残してある。

`sync-reference-repos.sh` は `DRY_RUN=1` と実行の両方で動作確認済み（24/24 成功）。
`print-missing-sources.mjs` は `--priority` / `--repos` / `--format tsv|urls` を確認済み。

---

## 未解決事項

### 情報を確認できなかったもの

| 項目                                                                         | 状況                                                                                 | 対応                                                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **BFS の原典**                                                               | Moore (1959) "The shortest path through a maze" を CrossRef で特定できなかった       | `algorithms.yaml` の `bfs` は `primary_paper_ids: []` のまま。捏造せず空にしてある                  |
| **CBS ジャーナル版の公開 PDF**                                               | Elsevier のみ。DU 機関リポジトリはメタデータのみで本文なし                           | 会議版 `cbs-aaai-2012` を代替として登録済み                                                         |
| **Hungarian Method の公開 PDF**                                              | Wiley 購読制。Semantic Scholar にも OA 版なし                                        | `link-only`。購読経由での入手が必要                                                                 |
| **Gale-Shapley の公開 PDF**                                                  | T&F 購読制。RAND P-2240 (1961) の直リンク PDF は特定できず                           | `link-only`。RAND ページを代替 URL に記録                                                           |
| **MDD-SAT の公開 PDF**                                                       | IOS Press 購読制                                                                     | `link-only`。当面 `compilation-survey-2022` で代替説明                                              |
| _*A* / Dijkstra の原典 PDF_*                                                 | IEEE / Springer 購読制                                                               | `link-only`                                                                                         |
| **`winpibt-2019` の掲載先**                                                  | arXiv 上はプレプリント。正式な会議名を確定できず                                     | `venue` に暫定記載、`notes` に要調査と明記                                                          |
| **「CBSB」の指すもの**                                                       | CBSB という名称が定着した手法名として使われている一次文献を見つけられず              | ICBS の Bypassing Conflicts (BP) を `cbs-bypass` に割り当て、CBSB を alias に。別手法なら分離が必要 |
| **Regret insertion の原典**                                                  | MAPF 文脈では RMCA が該当。VRP 由来の古典（Potvin & Rousseau 1993 とされる）は未確認 | `regret-insertion` の `primary_paper_ids` は RMCA のみ                                              |
| **Focal Search の原典**                                                      | Pearl & Kim (1982) とされるが未調査                                                  | BCBS/ECBS 論文を暫定的に一次出典にしてある                                                          |
| **ITA-CBS の保証**                                                           | アブストラクトの「is guaranteed to find …」の抽出が途中で切れ、対象を確定できず      | `guarantees` は `unknown`。PDF 取得後に確定                                                         |
| **`ta-prioritized-hybrid-aamas-2019` の DOI**                                | CrossRef で特定できず                                                                | `doi: null`                                                                                         |
| **`eecbs-aaai-2021` / `sippwrt-aaai-2019` / `pbs-aaai-2019` の AAAI 版 DOI** | 未確認                                                                               | `doi: null`。arXiv / 著者版を pdf_url に                                                            |
| **`public-cppmomapf` の対応論文**                                            | 多目的 MAPF（MOM* / MO-CBS）で本サイトの初期スコープ外                               | `paper_ids: []`。扱う段階で調査                                                                     |

### ライセンスを確認できなかったもの

| 対象                                                                                                               | 状況                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 参照実装 5 件（`push-and-rotate-cbs-pp` / `public-cppmomapf` / `mapf-icbs` / `mapf-lns-unified` / `awesome-mapf`） | LICENSE ファイルなし。`copy_allowed: false`                                                                                          |
| `primal` / `primal2`                                                                                               | LICENSE.md の著作権者が `.NET Foundation and Contributors`。要著者確認                                                               |
| 論文 17 本                                                                                                         | `redistribution: unknown`（著者個人ページ、IJCAI PDF など権利表示が見つからないもの）。SOURCE_POLICY.md 第 12 条により外部リンクのみ |

再配布可否の内訳: `allowed` 5 / `link-only` 30 / `unknown` 17。

### 次にやること

1. **ユーザ作業**: P0 の 9 本の PDF 取得と Marker 変換（[SOURCE_ACQUISITION.md](SOURCE_ACQUISITION.md) のチェックリスト）
2. Marker 出力の PDF 照合、`metadata.yaml` の `acquired` / `reading` を記入
3. P0 相当の手法の理論保証を `unknown` から確定させる（定理番号つき）
4. 上記が済んでからサイト本体の設計に着手する

### 注記

検証のために論文 PDF を一時ディレクトリ（`/tmp/.../scratchpad/`）へダウンロードして
タイトル照合に使ったが、**リポジトリ内には PDF を 1 本も配置していない**
（「PDF や Marker Markdown を自動ダウンロード・自動生成しない」という指示に従った）。
`docs/papers/*/paper.pdf` は 52 本すべて未取得である。

---

## 2026-07-26（追記2）— PDF 37 本の取り込みと再配布可否の修正（担当: Claude Code / 取得はユーザ）

ユーザが `docs/papers/` へ PDF 37 本を配置。うち 31 本は `<paper-id>/paper.pdf` として、
6 本は元のファイル名のまま `docs/papers/` 直下に置かれていた。

### 検証

37 本すべてについて `pdftotext` で 1 ページ目のタイトル・著者・掲載誌を抽出し、
`papers.yaml` の記載と照合した。**全件一致。** `pdfinfo` でページ数も取得し、破損・途中切れは 0 件。

### 実施内容

**A. 直置き PDF 6 本を `<paper-id>/paper.pdf` へ移動**（移動のみ。削除・上書きなし）

| 元ファイル名                                                                              | 移動先                  |
| ----------------------------------------------------------------------------------------- | ----------------------- |
| `A note on two problems in connexion with graphs.pdf`                                     | `dijkstra-1959`         |
| `A_Formal_Basis_for_the_Heuristic_Determination_of_Minimum_Cost_Paths.pdf`                | `astar-1968`            |
| `COLLEGE ADMISSIONS AND THE STABILITY OF MARRIAGE.pdf`                                    | `gale-shapley-1962`     |
| `Conflict-based search for optimal multi-agent pathfinding.pdf`                           | `cbs-aij-2015`          |
| `Efficient SAT approach to multi-agent path finding under the sum of costs objective.pdf` | `mdd-sat-ecai-2016`     |
| `THE HUNGARIAN METHOD FOR THE ASSIGNMENT PROBLEM.pdf`                                     | `hungarian-method-1955` |

これで「購読が必要」と記録していた 6 本がすべて揃った。

**B. `status` を `missing` → `pdf-ready` へ更新（37 件）**

あわせて各 `docs/papers/<id>/metadata.yaml` の `acquired` を記入した（37 件）。

- `pdf_downloaded_at` — ファイルの mtime から
- `pdf_sha256` — 実ファイルのハッシュ
- `pdf_page_count` — `pdfinfo` の出力

`papers.yaml` はコメントを多数含むため、parse → serialize ではなくエントリ単位の
行置換で書き換えた（コメントを失わないため）。

**C. `mdd-sat-ecai-2016` の再配布可否を修正**

PDF 1 ページ目に次の記載があり、購読制ではなく Open Access だったことが判明した。

> published online with Open Access by IOS Press and distributed under the terms of the
> Creative Commons Attribution Non-Commercial License 4

`open_access: false → true`、`redistribution: link-only → allowed`、
`evidence_url` に CC BY-NC 4.0 の URL を設定。
**出版社のランディングページだけでは再配布可否を判断できない実例**として
SOURCE_POLICY.md 第 12 条に追記した。

**D. 追加調査 — `unknown` のまま PDF が揃った 13 本の権利表示を 1 ページ目で確認**

C と同じ手口で全件を洗った結果、1 件だけ判定を変えられた。

- `cbsh-icaps-2018` — 1 ページ目に `Copyright 2018, AAAI. All rights reserved.` を確認 →
  `unknown` → `link-only` へ更新
- 残り 12 本（IJCAI 各年、`mstar-aij-2015`、`sipp-icra-2011`、`auction-algorithm-1988`）は
  1 ページ目に権利表示が無く、判定できないため `unknown` のまま据え置いた

### 併せて更新したファイル

- `SOURCE_POLICY.md` — 第 12 条の `allowed` 一覧を 5 本 → 6 本、ランディングページ依存の危険性を追記
- `SOURCE_ACQUISITION.md` — `allowed` 本数、MDD-SAT の行を取得済みへ
- `MISSING_PAPERS.md` — 実ファイルの有無から再生成（37 本 → **15 本**）

### 現状

```text
papers        : 52 件  (missing=15, pdf-ready=37, marker-ready=0, verified=0)
errors=0 warnings=14
```

再配布可否の内訳: `allowed` 6 / `link-only` 30 / `unknown` 16。

残る warning 14 件は、`unknown` のまま PDF がある 13 件（外部リンクのみに留める方針なので実害なし。
PDF は `.gitignore` 済みでサイト出力にも入らない）と、BFS の出典欠如 1 件。

### 未取得の 15 本

`docs/output/` に Marker Markdown だけがある 15 本。全て無料で取得できる。

`mapf-benchmarks-2019` `pbs-aaai-2019` `lacam-aaai-2023` `lacam3-aamas-2024`
`mapf-lns-ijcai-2021` `mapf-lns2-aaai-2022` `rhcr-aaai-2021` `mapd-tp-tpts-central-2017`
`ta-prioritized-hybrid-aamas-2019` `mla-star-icaps-2019` `rmca-ral-2021` `mg-mapd-iros-2022`
`sippwrt-aaai-2019` `cbm-tapf-aamas-2016` `cbs-ta-aamas-2018`

### 次にやること

1. 上記 15 本の PDF を取得（`MISSING_PAPERS.md` の一括コマンド）
2. `docs/output/` の Markdown 55 本を `docs/papers/<paper-id>/marker.md` + `images/` へ取り込み
   （重複 2 組の整理とディレクトリ名の対応付けが必要）
3. `papers.yaml` 未登録の約 40 本（MAPD 拡張・RMFS / OR 文献・割当 / VRP 理論）の書誌調査と登録
4. P0 相当の手法の理論保証を `unknown` から確定させる

---

## 2026-07-26（追記3）— PDF 全 52 本の取得完了と再配布可否の一斉確定（担当: Claude Code / 取得はユーザ）

ユーザが残り 15 本の PDF を取得。**`papers.yaml` の 52 本すべてに `paper.pdf` が揃った。**
あわせて 1 ページ目の権利表示を全件スキャンし、再配布可否を確定させた。

### 実施内容

**1. `status` を `pdf-ready` へ（15 件）+ `metadata.yaml` の `acquired` 記入（15 件）**

これで 52/52 が `pdf-ready`。全件で `pdf_sha256` と `pdf_page_count` を記録済み。

**2. 1 ページ目の権利表示から `unknown` → `link-only`（3 件）**

`pbs-aaai-2019` / `cbs-ta-aamas-2018` / `ta-prioritized-hybrid-aamas-2019`。
いずれも著者ページ・IFAAMAS 版の PDF 1 ページ目に "All rights reserved" を確認した。

**3. `ita-ecbs-socs-2024` を `allowed` → `link-only` へ引き下げ（権利表示の矛盾）**

★ 重要な発見。arXiv の abs ページは **CC BY-SA 4.0** を宣言しているが、
PDF 本文 1 ページ目には AAAI テンプレート由来の
「Copyright © 2024, Association for the Advancement of Artificial Intelligence.
All rights reserved.」が入っていた。

会議のカメラレディをそのまま arXiv へ投稿すると起こる食い違いで、arXiv 全般に起こりうる。
**矛盾する権利表示のうち厳しい側を採る**方針で `link-only` へ引き下げた。
SOURCE_POLICY.md 第 12 条に、`allowed` にしてよいのは
「arXiv のライセンス表示と PDF 本文の権利表示が矛盾しないことを確認できた場合だけ」と明記した。

**4. IJCAI 収録論文 10 件を `unknown` → `link-only`**

PDF 本文には権利表示が無いが、IJCAI の proceedings ページに次の記載があることを
2011 / 2015 / 2019 / 2021 / 2022 / 2023 の全年で確認した。

> Copyright © YYYY International Joint Conferences on Artificial Intelligence.
> All rights reserved. No part of this book may be reproduced in any form by any electronic
> or mechanical means ... without permission in writing from the publisher.

対象: `icts-ijcai-2011` `push-and-swap-ijcai-2011` `icbs-ijcai-2015` `ccbs-ijcai-2019`
`cbsh2-ijcai-2019` `bcp-ijcai-2019` `smt-cbs-ijcai-2019` `mapf-lns-ijcai-2021`
`compilation-survey-2022` `lacam-star-ijcai-2023`

### 再配布可否の最終状態

| status      | 件数 | 内訳                                                                                                                                                                     |
| ----------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `allowed`   | 5    | `lacam3-aamas-2024`(CC BY 4.0) / `ita-cbs-mrs-2023`(CC BY 4.0) / `pibt-aij-2022`(CC BY-NC-ND 4.0) / `rmca-ral-2021`(CC BY-NC-ND 4.0) / `mdd-sat-ecai-2016`(CC BY-NC 4.0) |
| `link-only` | 44   | AAAI / IJCAI / IFAAMAS / IEEE / Elsevier / Wiley / T&F                                                                                                                   |
| `unknown`   | 3    | `mstar-aij-2015` / `sipp-icra-2011` / `auction-algorithm-1988`                                                                                                           |

`unknown` の 3 本は、いずれも著者個人ページに置かれた出版社論文の著者版で、
PDF 本文にも配布元にも再配布許諾の記載が無い。判定できないため `unknown` のまま据え置いた。

### 併せて更新したファイル

- `SOURCE_POLICY.md` — `allowed` 一覧を 5 本へ。「再配布可否は PDF 本文で確認する」節を新設し、
  MDD-SAT（引き上げ）と ITA-ECBS（引き下げ）の 2 例を記録
- `SOURCE_ACQUISITION.md` — 全面再生成。役割を「PDF 取得手順」から
  「取得完了 + Marker 変換手順」へ切り替え、全 52 本の一覧表を自動生成
- `MISSING_PAPERS.md` — 全面再生成。PDF は 0 本未取得、Marker 未変換 52 本の一覧へ

### 現状

```text
papers        : 52 件  (missing=0, pdf-ready=52, marker-ready=0, verified=0)
errors=0 warnings=4
```

残る warning 4 件は、`unknown` の 3 件（外部リンクのみに留める方針なので実害なし）と
BFS の出典欠如 1 件。

### 次にやること

1. **Marker 変換 52 本。** うち 15 本は `docs/output/` に変換済み Markdown があるため移送のみ
   （ただし `marker_meta.json` が無いので移送後も warning は残る）
2. `docs/output/` の `papers.yaml` 未登録 約 40 本の書誌調査と登録
   （MAPD 拡張・RMFS / オーダーピッキングの OR 文献・割当 / VRP 理論。OR 系は分類の新設が必要）
3. Marker Markdown と PDF の照合 → `metadata.yaml` の `reading` 記入 → `status: verified`
4. P0 相当の手法の理論保証を `unknown` から確定させる（現在 71 件が `unknown` を含む）

---

## 2026-07-26（追記4）— docs/output の Markdown 移送と Marker 変換キューの作成（担当: Claude Code）

### 1. `docs/output/` → `docs/papers/<paper-id>/` の移送（15 本）

**移動ではなくコピーで行った。** `docs/output/` は `papers.yaml` 未登録の約 40 本を含む
ユーザの原本コレクションであり、そこから 15 本だけ抜くと不完全になるため。
`docs/output/` は 57 ディレクトリのまま無傷。

各論文について次を配置した。

- `docs/output/<タイトル>/<タイトル>.md` → `docs/papers/<paper-id>/marker.md`
- `docs/output/<タイトル>/_page_*.jpeg` → `docs/papers/<paper-id>/images/`（計 100 枚）
- 日本語メモ（`summary_ochiai_ja.md` 5 件、`PBS_explanation_ja.md`、
  `HBH_MLA_star_explanation_ja.md`）→ 対応する `docs/papers/<paper-id>/` へ原名のまま

移送した 15 本: `mapf-benchmarks-2019` `pbs-aaai-2019` `lacam-aaai-2023` `lacam3-aamas-2024`
`mapf-lns-ijcai-2021` `mapf-lns2-aaai-2022` `rhcr-aaai-2021` `mapd-tp-tpts-central-2017`
`ta-prioritized-hybrid-aamas-2019` `mla-star-icaps-2019` `rmca-ral-2021` `mg-mapd-iros-2022`
`sippwrt-aaai-2019` `cbm-tapf-aamas-2016` `cbs-ta-aamas-2018`

**重複ペアの解決**: `Multi-Goal Multi-Agent Pickup and Delivery`（スペース版）と
`Multi-Goal_Multi-Agent_Pickup_and_Delivery`（アンダースコア版）は同一論文の 2 回変換だった。
表 I のヘッダがスペース版では `| 1:01 | 1. |` に化けており、アンダースコア版では
`| lifelong | online |` が正しく残っていたため、**アンダースコア版を採用**した。
スペース版は `docs/output/` にそのまま残してあるので、後から比較できる。

もう 1 組の重複（`Preventing Deadlocks for MAPD ...`）は `papers.yaml` 未登録のため対象外。

`status` を `pdf-ready` → `marker-ready` へ更新（15 件）。
`metadata.yaml` の `marker_version` / `marker_meta_present` に「別環境で変換済み・
`marker_meta.json` なし」の注記を入れた。

### 2. Marker 変換待ち PDF の zip 化（37 本）

```text
pdfs-to-markdown.zip   43MB / 39 ファイル（PDF 37 + README.md + manifest.tsv）
```

- PDF は `<paper-id>.pdf` にリネームして収めた。`papers.yaml` と一対一で対応するため、
  変換後にどこへ戻せばよいかが機械的に分かる
- `README.md` に戻し方（`marker.md` / `marker_meta.json` / `images/` へのリネーム）、
  優先度別の内訳、全 37 本の一覧を同梱
- `manifest.tsv` に `paper_id / priority / pages / title / venue / year`
- **再配布不可の PDF を含むため `.gitignore` に `/*.zip` を追加した**（コミット厳禁）

### 現状

```text
papers : 52 件  (missing=0, pdf-ready=37, marker-ready=15, verified=0)
errors=0 warnings=19
```

warning 19 件の内訳:

- `marker_meta.json` が無い 15 件 — `docs/output/` からの移送のため。Marker の出力そのものが
  無いので取得しようがない。仕様どおり error ではなく warning に留めてある
- 再配布可否が `unknown` の 3 件（`mstar-aij-2015` / `sipp-icra-2011` / `auction-algorithm-1988`）
- BFS の出典欠如 1 件

### 次にやること

1. `pdfs-to-markdown.zip` の 37 本を Marker で変換し、`docs/papers/<paper-id>/` へ戻す
2. Marker Markdown と PDF の照合 → `metadata.yaml` の `reading` 記入 → `status: verified`
3. `docs/output/` の `papers.yaml` 未登録 約 40 本の書誌調査と登録
4. P0 相当の手法の理論保証を `unknown` から確定させる

---

## 2026-07-26（追記5）— docs/output2 の Marker Markdown 移送（担当: Claude Code / 変換はユーザ）

`pdfs-to-markdown.zip` の 37 本が変換され、`docs/output2/` として追加された。
**`docs/output2` = `docs/output` の 57 本 + 新規 37 本（計 94）。**
新規分は `<paper-id>/<paper-id>.md` という名前で、zip へ入れるときに付けた paper-id が
そのまま維持されていたため、対応付けは機械的に決まった。

### 実施内容（方針 A: 混入部分も残して移送）

37 本を `docs/papers/<paper-id>/` へ**コピー**した（`docs/output2` は原本として無傷）。

- `<paper-id>.md` → `marker.md`
- `_page_*.jpeg` → `images/`（今回 277 枚、既存と合わせて計 377 枚）
- `status` を `pdf-ready` → `marker-ready`（37 件）

**これで 52 本すべてが `marker-ready` になった。**

### 誌面スキャン由来の混入・崩れ 4 件（`metadata.yaml` の `verification.notes` に記録）

方針 A に従い、**本文は PDF とのページ対応を保つため削っていない。**

| paper-id                 | 内容                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `astar-1968`             | 1-62 行目が同誌の前論文（非線形計画法）の参考文献。IEEE Trans. SSC vol.4 no.2 の p.100 が前論文の末尾と重なるため。本論文は 63-418 行目 |
| `gale-shapley-1962`      | 1-28 行目が JSTOR の前付け、145-150 行目が次論文「GRADUATED INTEREST RATES IN SMALL LOANS」。本論文は 29-144 行目                       |
| `auction-algorithm-1988` | 誌面スキャンの OCR 崩れ（「1. INTRODUf;rION」「rnin-cost」「nonline;ar」「(-relaxation」）。数式・記号の引用時は必ず PDF と照合         |
| `cbs-aij-2015`           | 先頭が Elsevier の誌面ヘッダ。混入ではなく掲載誌のレイアウトどおり                                                                      |

全文検索でこれらを使うときは、注記の行範囲に限定すること。

### バリデータの改修 — `marker_meta.json` 警告の集約

`marker_meta.json` は **52 本すべてで存在しない**（Marker が出力していない）。
1 本ずつ warning を出す実装だったため警告が 56 件に膨れ、
`unknown` の 3 件や BFS の 1 件が埋もれて読めなくなっていた。

「存在しない場合も明確に警告する」という当初要件は維持したまま、
**集約して 1 件の warning にした**。件数と先頭 5 件を出し、全件は別コマンドで見る。

```bash
node scripts/print-missing-sources.mjs --marker-meta   # 新設
```

結果、warnings は 56 → **5** になった。

### 現状

```text
papers : 52 件  (missing=0, pdf-ready=0, marker-ready=52, verified=0)
errors=0 warnings=5
```

warning 5 件の内訳:

- `marker_meta.json` が無い 52 件（集約して 1 件）
- 再配布可否が `unknown` の 3 件（`mstar-aij-2015` / `sipp-icra-2011` / `auction-algorithm-1988`）
- BFS の出典欠如 1 件

### 併せて更新したファイル

- `scripts/validate-sources.mjs` — `marker_meta.json` 警告の集約
- `scripts/print-missing-sources.mjs` — `--marker-meta` を新設
- `AGENTS.md` — コマンド一覧に `--marker-meta` を追加
- `SOURCE_ACQUISITION.md` — 全面再生成。役割を「Marker 変換手順」から「PDF 照合手順」へ切り替え、
  全 52 本の一覧（頁数・md 行数・画像数・再配布・status）と ★ 注意論文の表を自動生成
- `MISSING_PAPERS.md` — 全面再生成。充足状況と、注意が要る 4 本・未判定 3 本・保証未確定 71 件の整理へ

### 次にやること

1. **PDF 照合（52 本）** — `marker.md` の数式・擬似コード・表を `paper.pdf` と目視照合し、
   `metadata.yaml` の `reading` にページ・節・Algorithm 番号を記録 → `status: verified`
2. 照合と並行して `algorithms.yaml` の理論保証 71 件を `unknown` から確定させる
3. `docs/output` / `docs/output2` の `papers.yaml` 未登録 約 40 本の書誌調査と登録
   （OR 系を受け入れる分類の新設が必要）
4. 上記が P0 相当まで済んだらサイト本体の設計に着手する

### 不要になったもの

`pdfs-to-markdown.zip`（43MB）は役目を終えた。`.gitignore` 済みなので放置しても害はないが、
削除してよい。

---

## 2026-07-26（追記6）— 機械照合（A）と理論保証の確定（B）（担当: Claude Code）

### A. marker.md と paper.pdf の機械照合

**前提**: 「目視照合」は人の作業であり、エージェントが代替することはできない。
やったのは機械照合、すなわち丸ごと落ちた要素と語数の目減りの検出までである。
数式の中身が正しいかは判定していないため、**52 本とも `status` は `marker-ready` のまま**。

新設: `scripts/check-marker-fidelity.mjs`

- `paper.pdf` をページ単位でテキスト化し、Algorithm / Theorem / Lemma / Definition /
  Proposition / Corollary / Figure / Table の番号付き要素とページ番号を索引化
- 同じ要素が `marker.md` にあるかを照合し、欠落を列挙
- 語数比（marker.md / PDF）と数式表現量を比較
- `--write` で各 `metadata.yaml` に `machine_index` セクションを書き込む（52 件更新済み）

#### 指標の設計で 2 回間違えた。両方とも記録しておく

1. **数式記号の残存率** — 当初は PDF の Unicode 記号（≤, ∈, α …）が marker.md に
   どれだけ残っているかで測ったが、**Marker は数式を LaTeX へ変換する**ため必ず「減った」と出る。
   実例: `icts-ijcai-2011` は marker.md の Unicode 記号 0 に対し `$...$` が 198 ブロック。
   35/52 本が偽陽性になっていた。marker.md 側を Unicode + TeX ブロック + LaTeX コマンドの
   合計で数えるよう修正。
2. **番号付き要素の検出** — 2 つの穴があった。
   - 空白に `\s` を使うと改行を跨ぎ、擬似コードの行番号を拾う。
     `ml-lns-aaai-2022` で「Algorithm 2: Training Algorithm」の次行「0: Input: ...」を
     "Algorithm 0" と誤検出していた。`[ \t]+` に限定して解消。
   - 大文字見出し（`THEOREM 4.`）を拾えず、`hungarian-method-1955` `winpibt-2019`
     `cbs-ta-aamas-2018` で偽の欠落が出ていた。`i` フラグ + キーの正規化で解消。

修正後、要確認は 36 本 → **2 本**になった。

#### 実際に見つかった欠落 2 件（`metadata.yaml` の `verification.notes` に記録）

| paper-id                | 内容                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hungarian-method-1955` | PDF にある **THEOREM 2**（There is an assignment which is complete after ...）と **THEOREM 4**（There is an adequate budget and an assignment ...）が marker.md に無い。1955 年の誌面スキャンの OCR で脱落。この 2 定理は PDF を直接読むこと                                                                                                                          |
| `pbs-aaai-2019`         | **Figure 5・6・7・8**（すべて実験結果の図）が無く、語数も PDF 比 **78%**（他は 100-105%）。Experiments 節の本文が大きく脱落。アルゴリズム定義（Priority-Based Search 節）と Theoretical Results 節は残っているため手法解説には使えるが、性能の記述は PDF 必須。**Marker で再変換すれば改善する可能性がある**（`docs/output` と `docs/output2` の版は md5 一致で同一） |

### B. 理論保証の確定

PDF 本文から定理・補題を抽出し、**17 手法**の `guarantees` を確定させた。
`guarantee_evidence` には原文（英語）とページ番号を入れてある。
`unknown` を含む手法は **71 件 → 60 件**。

特に重要な 3 件:

- **`pibt`** — pibt-aij-2022 p.3「The proposed method, PIBT, is **neither complete nor optimal**
  for MAPF.」/ p.12「with the graph condition of Theorem 1, PIBT is complete for the MAPF
  variant where agents need not necessarily stay at their goals.」
  → 古典的 MAPF では完全でも最適でもなく、ゴール滞在を要求しない変種でのみ条件付きで完全。
- **`lacam-star`** — lacam-star-ijcai-2023 p.4 は「LaCAM∗ (Alg. 3) is complete and optimal.」と
  書いているが、同論文のタイトルは「Eventually Optimal」、lacam3 のアブストラクトも
  「guarantees the eventual finding of optimal solutions」。**有限時間の最適性ではない**ため
  `optimal: conditional` とし、両方の原文を evidence に併記した。
- **`push-and-rotate`** — cbs-aij-2015 p.5「complete for graphs where at least two vertices
  are always unoccupied, i.e., k ≤ |V| − 2」→ 条件を数式で特定できた。

その他の確定: `cbs`(Theorem 1) `ma-cbs` `bcbs` `ecbs` `eecbs` `operator-decomposition`
`independence-detection` `mstar`(Theorem 1「M* is complete and optimal.」) `push-and-swap`
`lacam` `cbm` `cbs-ta`(Theorem 4.1/4.2) `ita-cbs` `pbs`。

`guarantee_evidence` を持つ手法は合計 **25 / 77**（今回の 17 + 既存 8）。

### 併せて更新したファイル

- `scripts/check-marker-fidelity.mjs` — 新設
- `docs/sources/algorithms.yaml` — 17 手法の保証と根拠、冒頭コメントを現状へ
- `docs/papers/*/metadata.yaml` — `machine_index` 52 件、欠落の注記 2 件
- `docs/README.md` — 保証の説明を現状へ。注意すべき確定結果 3 件を明記
- `AGENTS.md` — `check-marker-fidelity.mjs` の使い方と「目視照合の代替ではない」注意
- `SOURCE_ACQUISITION.md` / `MISSING_PAPERS.md` — 再生成

### 現状

```text
papers     : 52 件 (missing=0, pdf-ready=0, marker-ready=52, verified=0)
algorithms : 77 件（保証が unknown を含むもの 60 件 / 根拠つき確定 25 件）
errors=0 warnings=5
```

### 次にやること

1. **人手の目視照合** — 機械照合では数式の中身を判定できない。
   P0 の 9 本から、`marker.md` の Algorithm ブロックと数式を PDF と突き合わせ、
   `metadata.yaml` の `reading` を埋めて `status: verified` にする
2. `pbs-aaai-2019` の Marker 再変換（Experiments 節の脱落）
3. 残り 60 手法の保証確定。`sipp` `icbs` `cbsh` `cbsh2` `disjoint-splitting` は
   今回の抽出パターンでは該当箇所を拾えなかったので、本文を直接読む必要がある
4. `docs/output` / `docs/output2` の未登録 約 40 本の書誌調査と登録

---

## 2026-07-27 — サイト基盤の構築（担当: Claude Code）

資料整備フェーズから実装フェーズへ移行。Astro による静的サイト基盤、シミュレータ、
出典表示システム、Codex 向けの拡張点を作った。**アルゴリズムの本格的な再現実装は行っていない。**

### 初期確認

- `git remote -v` = `https://github.com/abigworld1/study-mapf.git`（指定どおり。変更なし）
- コミットは 0 件のまま。破壊的な Git 操作はしていない
- Node v22.21.1 / npm 10.9.4 → astro 7 の要件（node >= 22.12.0）を満たす
- `sources:validate` errors=0、PDF 52/52、marker.md 52/52 を確認
- 既存ファイルと Astro の標準構成（`src/` `public/` `dist/` `package.json`）は衝突なし

### 技術選定で実際に確認したこと

**Astro は 7.1.3 が最新**だった。5 系の設定例はそのまま使えないため、
インストール後に型定義とソースを読んで API を確認した。

- content collections は `src/content.config.ts` + `astro/loaders` の `glob()`
- `markdown.remarkPlugins` / `rehypePlugins` は非推奨。
  `@astrojs/markdown-remark` の `unified()` を `markdown.processor` へ渡す形に修正
- ESLint は 10.8.0 が最新だが、`eslint-plugin-jsx-a11y` の peer が `^9` までで衝突する。
  **9.39.5 で固定**した

### 実装したもの

- **基盤**: Astro 7 + TypeScript strict + React islands + MDX + KaTeX（CDN 非依存）
- **base path**: `src/config/site.mjs` の 1 箇所で定義。参照は `src/lib/paths.ts` の
  `withBase()` / `assetUrl()` を通す。文字列結合を散らしていない
- **ドメインモデル**: `GridMap` `Scenario` `SolverEvent` `MapfSolver` ほか、仕様の全型を定義
- **Solver**: BFS / A*（各エージェント独立）、時空間 A*（1 体のみ回避）、
  固定優先順位の優先順位付き計画。Web Worker で実行、`AbortSignal`・seed 決定性・
  タイムアウト・展開上限・構造化エラーに対応
- **描画**: Canvas 2D。10 レイヤ。アルゴリズムロジックから完全に分離。
  色に加えて形と番号でエージェントを識別し、盤面を文章でも出す
- **シミュレータ**: グリッド編集、8 プリセット、再生制御、指標表示、JSON import/export、
  MAPD タスク生成（Solver 未実装のため実行はできない旨を明示）
- **出典システム**: 8 コンポーネント。実装状態は宣言ではなく registry から判定する
- **ページ**: 61 ページ（サイト 11 + アルゴリズム 37 + 分類 12 + 一覧）

### 途中で見つけて直した不具合

1. **ビルドが ENOENT で落ちた** — `manifest.ts` が `fs.readFileSync` + `import.meta.url` で
   YAML を読んでいたが、prerender 時に `dist/.prerender/` へバンドルされて `docs/` を見失う。
   `?raw` でビルド時に埋め込む方式へ変更
2. **`getCollection()` が any になった** — `tsconfig.json` の `exclude` に `.astro` を入れており、
   生成された `content.d.ts` が読まれていなかった。exclude から外した
3. **Warehouse プリセットのエージェントが棚の上にいた** — 検証テストで検出。x=10 は棚の列だった
4. **中断が効かない場合があった** — 既に abort 済みの `AbortSignal` を渡すと
   `addEventListener("abort")` が発火せず伝わらない。現在の状態も見るよう修正
5. **★ Prettier がマニフェストを壊した** — `authors: [...]` を複数行へ折り返し、
   自作 YAML パーサが読めなくなって `papers/repositories/algorithms` が全部 0 件になった。
   パーサを複数行フローシーケンス対応にし、`docs/sources/` を `.prettierignore` へ追加。
   退行検出のため `tests/unit/mini-yaml.test.ts` を新設
6. **Swap Conflict プリセットが解けなかった** — 退避場所が中央だと、先に計画される a1 が
   直進した時点で a2 の逃げ場が無くなる。これは優先順位付き計画の不完全性そのもの。
   教材として「解ける最小例」にしたかったため、退避場所を a2 側へ寄せた

### 品質ゲート（すべて通過）

```text
format:check   All matched files use Prettier code style!
lint           0 problems
typecheck      0 errors（64 files）
test           67 passed（6 files）
build          61 pages
e2e            13 passed
sources        errors=0 warnings=5
```

追加の検査:

- `dist/` の全 HTML に `/study-mapf/` 以外のルート絶対パスが無いことを確認
- `dist/` に PDF が 1 件も混入していないことを確認

### 未解決事項

1. **MAPD 対応の Solver が無い。** タスクの編集・生成・JSON 保存はできるが実行できない
2. **Moving AI の `.map` / `.scen`** はパーサとテストのみ。シミュレータ UI からの読み込みは JSON だけ
3. **予約表・制約レイヤ**は描画側に口があるが UI から可視化していない
4. **解説本文は全ページ `draft`。** 資料不足のページは `<PreparingNotice />` を出し、
   もっともらしい文章で埋めていない
5. **本リポジトリのコードのライセンス未定**
6. 時空間 A* の open list は配列 + 線形探索。教材規模では十分だが大規模では遅い

### 次にやること

Codex が実装すべき順序は README と ALGORITHM_IMPLEMENTATION_GUIDE を参照。
最初は CBS（保証が確定済み・他手法の土台・低レベル探索を再利用できる）を推奨。

---

## 2026-07-27（追記）— Codex 引き継ぎ用の共有 API 拡張（担当: Claude Code）

Codex へ渡す予定のプロンプトを実際の API と突合したところ、**要求する型が存在しない**箇所が
複数見つかった。プロンプトは同時に「大規模なアーキテクチャ変更は行わない」とも指示しており、
Codex が矛盾した指示に挟まれる状態だったため、先に共有側を整えた。

### 拡張した内容

1. **`SolverResult` / `SolverMetrics`** — `generatedNodes` `conflictsDetected` `replans`
   `lowerBound` `suboptimalityBound` `failureReason` `warnings` `trace` を追加。
   `buildResult()` に `ExtraMetrics` 引数を足し、`lowerBound` から `suboptimalityBound` を自動計算
2. **`SolverEvent`** — 13 種類 → 37 種類。SIPP / CBS / PBS / PIBT / LaCAM / LNS / MAPD の
   各ファミリで必要になるイベントを型に入れた。`SolverOptions.traceLevel` と
   `createTraceRecorder()` で詳細度と件数を制御する
3. **`SolverMetadata.fidelity`** — `educational | paper-faithful | reference-validated |
explanation-only`。`status`（動くか）とは別軸として追加。`validatedAgainst` も
4. **参照ソルバ** — `src/solvers/reference/joint-state.ts`。
   `jointStateBfs`（makespan 最適・BFS）と `jointStateOptimalSumOfCosts`（SOC 最適・IDA*）
5. **安全弁** — `SolverOptions` に `maxAgents` `maxGridArea` `maxHorizon` `maxTraceEvents` を追加。
   `checkLimits()` で探索前に弾く。既存 4 Solver にも組み込み済み
6. **雛形** — `THIRD_PARTY_NOTICES.md`、`IMPLEMENTATION_STATUS.md`、
   `docs/notes/implementation/{README,_TEMPLATE}.md`

### 参照ソルバの設計で 1 度やり直した

最初は「ゴール到達後は動かない」前提の DFS で SOC 最適を求めようとしたが、
5×3 の通路インスタンスで指数爆発してテストが 10 分でも終わらなかった。

原因は枝刈りの欠如だけではない。**素朴なコスト関数（ゴールで待つのは無料）は
一度ゴールへ着いてから他を通すために離れる経路を過小評価する。**
オラクルが間違うと検証全体が無意味になる。

IDA* へ作り直した。g（過小評価）を枝刈りにだけ使い、採否は実際の `sumOfCosts()` で判定する。
g は下界なので `g + h > budget` の枝刈りは最適解を落とさず、予算を下界から 1 ずつ上げるため
最初に見つかった解が最適になる。31ms で通るようになった。

保証できる範囲は型と JSDoc に明記した（`sumOfCostsCertified` が `false` のときは
最適を主張してはならない）。極小インスタンスを超えると例外を投げ、黙って間違えない。

### 品質ゲート

```text
sources:validate  errors=0 warnings=5
format:check      All matched files use Prettier code style!
lint              0 problems
typecheck         0 errors（67 files）
test              75 passed（7 files）
build             61 pages
```

### 成果物

`CODEX_PROMPT.md` — 実際の型に合わせて書き直した Codex 用プロンプト。
初版からの変更点をファイル冒頭に列挙してある。

---

## 2026-07-27 — Batch 1 + HCA* の独立実装（担当: Codex）

### 対象アルゴリズム

`space-time-astar`、`sipp`、`prioritized-planning`、`cooperative-astar`、
`hca-star`、`whca-star` の 6 件。前二者のうち Space-Time A* と Prioritized Planning は
既存の educational 実装を差し替え、残り 4 件を registry へ追加した。

### 原論文で確認した箇所

- `cooperative-pathfinding-2005` PDF p.2: Space-Time search、CA*、reservation table、
  greedy decoupled approach の限界と Figure 1
- 同 pp.2-3: HCA* の abstraction と Algorithm 1 Reverse Resumable A*
- 同 pp.3-4、p.6: WHCA* の terminal edge / cost、midpoint 再計画、RRA* 再利用、
  window size と bottleneck の実験的関係
- `sipp-icra-2011` PDF pp.2-5: safe interval、Figure 4 / 5、Theorem 1 / 2 / 3
- `pbs-aaai-2019` PDF pp.2-3: Prioritized Planning、Theorem 1 / 3 / 4 / 6、
  Corollary 5。p.7 の「4%」は実験観測であって保証ではないことも確認

PDF と Marker の機械照合では cooperative-pathfinding と SIPP に番号付き要素の欠落なし。
PBS は既知どおり語数比 78% で Figure 5-8 が欠落しているため、該当する実験記述は PDF を直接確認した。
3 論文の `metadata.yaml` に読解箇所と差異を記録した。全文の行単位照合ではないため
`verification.checked_against_pdf` は `false` のままにした。

### 公開実装の扱い

- `.references/libmultirobotplanning` commit `4c75fa2` を read-only で確認。
  SIPP の `(location, safe interval)` 状態と固定順適用を比較した。example の edge-swap 判定には TODO がある
- `.references/pibt2` commit `faab5b9` を read-only で確認。
  HCA は distance-first priority と start / goal tie-break を採用するが、今回は論文との比較を明確にするため採用しなかった
- `pibt2` はサブモジュール未取得のためビルド不可。確認した source tree に WHCA* 本体は無い

第三者コードは転記していないため、`THIRD_PARTY_NOTICES.md` の変更は無い。

### 実装

- `src/solvers/low-level/`: `(cell,time)` Space-Time A*、safe interval SIPP、
  Algorithm 1 の on-demand RRA*、WHCA* 用 window terminal search
- `src/solvers/prioritized/`: 固定順 coordinator、CA*、HCA*、SIPP MAPF wrapper、
  rolling-window WHCA*。全 Solver が `checkLimits()`、global expansion budget、timeout、
  AbortSignal、deterministic tie-break、trace recorder、structured failure を使用
- `src/lib/model/reservation.ts`: `goalBehavior` を尊重する予約 helper
- `src/solvers/registry.ts`: 実装済み 6 Solver を登録
- `src/content/algorithms/`: 6 件の日本語解説を `reviewed` として作成・更新。
  HCA* ページを新設し、各ページに「サイト上の実装との差異」を記載
- `docs/notes/implementation/`: 6 件の実装前調査ノートを作成

### テスト

`tests/unit/batch1-solvers.test.ts` と共有 `tests/helpers/check-paths.ts` を追加した。

- 全 6 Solver の registry / metadata、決定性、timeout、abort、入力 guard
- Space-Time A* の単一 agent 最短路、following、stay / disappear reservation
- SIPP の safe interval 分割、wait-and-move、Space-Time A* との最早到着比較
- RRA* と静的 BFS true distance の一致、Closed の再利用
- CA* / HCA* / SIPP wrapper / WHCA* の経路不変条件と trace event
- joint-state BFS が解を確認する中央退避所で、固定 Prioritized Planning が失敗する不完全例
- WHCA* の複数 window、再計画、option validation
- node / trace 上限

既存 `tests/unit/solvers.test.ts` と `tests/unit/invariants.test.ts` は削除・skip・弱体化せず通過した。

### 理論保証の書き戻し

`docs/sources/algorithms.yaml` を次のように更新した。

- SIPP: `complete: true`、`optimal: true`（time-minimal）、Theorem 1 / 2 を evidence に記録
- Prioritized Planning: `complete: false`、`optimal: false`、Theorem 1 / 4 と Corollary 5 へ evidence を具体化
- CA*: `complete: false`、Figure 1 と p.2 本文を evidence に記録。`optimal` は `unknown`
- HCA*: `complete: false`。CA* の heuristic 置換である p.3 と p.2 の限界を evidence に記録。`optimal` は `unknown`
- Space-Time A*: 独立手法の定理を確認できないため complete / optimal は `unknown`
- WHCA*: p.6 は実験観測で定理ではないため complete / optimal は `unknown`

保証に `unknown` が残る手法は 60 件から 59 件へ減った。

### 論文とブラウザ実装の主な差異・簡略化

- edge-swap / following と有限 horizon はサイト共通ルールへの拡張
- SIPP は連続 configuration / motion duration を離散 4 近傍へ限定し、MAPF 実行時は固定順 wrapper を使用
- HCA* の一般 graph 向け successor-order reversal は決定的な grid tie-break へ限定
- WHCA* は全 agent の window を同期し、単純 rotation と bounded retry を使用。
  原論文の staggered frame scheduling は未対応
- WHCA* はサイト既定 `goalBehavior: stay` を優先するため、原論文の「goal 到達後に一時的に離れて協力する」挙動は未対応

### 品質ゲート

```text
sources:validate  errors=0 warnings=5
format:check      All matched files use Prettier code style!
lint              0 problems
typecheck         0 errors（76 files、既存 Astro deprecation hints 22）
test              91 passed（8 files）
build             62 pages
e2e               26 passed（Chromium desktop + mobile）
```

`npm ci` は完了したが、npm audit の既存 high severity 6 件は今回のスコープ外なので変更していない。
コミットは作成していない。

### 次の推奨バッチ

Batch 2: `cbs` / `bcbs` / `ecbs` / `icbs` / `eecbs`。

---

## 2026-07-27 — Batch 2 CBS family の独立実装（担当: Codex）

### 1. 対象アルゴリズム

`cbs`、`bcbs`、`ecbs`、`icbs`、`eecbs` の 5 件。CBS / BCBS / ECBS / EECBS は
`runnable`、ICBS は PC+BP subset のため `partial` として registry へ登録した。

### 2. 参照した論文と節

- `cbs-aij-2015` PDF §§4.1–4.3, §§5.1–5.2、pp.8–13。Algorithm 2、edge conflict、
  CAT tie-break、Theorem 1 / 3、unsolvable instance に関する §5.2.2
- `bcbs-ecbs-socs-2014` PDF pp.5–6。focal search、BCBS、Theorem 1、ECBS の
  `LB(N)=Σ fmin(i)` と完全性の記述
- `icbs-ijcai-2015` PDF pp.1–5。Algorithm 1、MA-CBS / MR、helpful BP、PC、MDD 分類
- `eecbs-aaai-2021` PDF §§2.1–3.4 と §4、pp.2–7。EES の 3 list、SELECTNODE、
  online one-step error、Algorithm 1、基礎 EECBS と §4 enhancements の区別

4 論文とも該当ページを PDF 画像で目視し、Marker fidelity は番号付き要素の欠落 0。
各 `metadata.yaml` の reading / discrepancies / verification notes を更新した。

### 3. 参照した公開実装

- `libmultirobotplanning` commit `4c75fa20...`（MIT）: CBS / ECBS の high-level key、
  low-level A* / A*-epsilon、earliest conflict を read-only で確認
- `eecbs` commit `06ec7058...`（USC 教育・研究・非営利限定）: 3 heap、SELECTNODE、
  online error と §4 enhancements を read-only で確認
- `mapf-icbs` commit `a1357b98...`（ライセンス無し）: MA / PC / BP 構造と乱択
  disjoint splitting を read-only で確認
- `cbsh2-rtc` commit `a834df1e...`（USC 独自ライセンス）: 閲覧のみ

`libmultirobotplanning` は `/tmp` で CMake configure に成功したが、環境に
`yaml-cpp/yaml.h` が無く example build が失敗した。外部依存を追加せず、固定ケースの binary 比較は
未実施。第三者コードは転記していないため `THIRD_PARTY_NOTICES.md` の変更は無い。

### 4. 実装したファイル

- `src/solvers/cbs/heap.ts`: 依存なし binary min-heap
- `src/solvers/cbs/low-level.ts`: negative vertex / edge constraint、CAT secondary、
  weight 1 または bounded focal の `(cell,time)` A*
- `src/solvers/cbs/core.ts`: immutable CT data、standard split、CBS / BCBS / ECBS selection、
  ICBS PC+BP、EECBS CLEANUP / OPEN / FOCAL と online error、共通 budget / trace / result
- `src/solvers/cbs/solvers.ts`: 5 Solver metadata と option validation
- `src/solvers/registry.ts`: 5 Solver を登録
- `src/content/algorithms/{cbs,bcbs,ecbs,icbs,eecbs}.mdx`: 日本語解説を `reviewed` へ更新
- `docs/notes/implementation/` に 5 件の実装前ノートを追加
- `docs/sources/algorithms.yaml`、`IMPLEMENTATION_STATUS.md` を更新

### 5. 追加・更新したテスト

`tests/unit/batch2-solvers.test.ts` を追加し、既存 `solvers.test.ts`、`invariants.test.ts`、
`site.spec.ts` を実装後の事実へ更新した。既存テストの削除・skip・弱体化はしていない。

- CBS / ICBS と `jointStateOptimalSumOfCosts()` の certified SOC optimum 一致
- BCBS / ECBS / EECBS の `cost <= w*optimal` と `w=1` の最適 cost
- `checkPaths()` による固定例と 12 seed の反復不変条件
- vertex / edge constraint、ICBS classification と実際の helpful bypass
- CT / conflict / constraint / replan / bypass event と trace
- 決定性、abort、timeout、global node limit、input guard、trace limit、option validation
- E2E で CBS ページの runnable 表示、CBS が選択肢に入り LaCAM が入らないこと

### 6–7. テスト・ビルド結果

```text
sources:validate  errors=0 warnings=6
format:check      All matched files use Prettier code style!
lint              0 problems
typecheck         0 errors（81 files、既存 Astro deprecation hints 22）
test              110 passed（9 files）
build             62 pages
e2e               26 passed（Chromium desktop + mobile）
```

`sources:validate` の既存 warning 5 件に、BCBS は独立実装が runnable だが登録済み公開参照実装が
無いという正しい warning が 1 件増えた。架空の repository ID は追加していない。

### 8. 理論保証と manifest への書き戻し

- CBS: `complete: conditional`, `optimal: true`。Theorem 3 は解があれば返すが、§5.2.2 は
  解なしの有限判定が常に成立しないと明記
- BCBS: `complete: true`, `optimal: false`, `bounded_suboptimal: true`。
  Theorem 1 の bound は `wH*wL`
- ECBS: `complete: true`, `optimal: false`, `bounded_suboptimal: true`。
  `LB(N)` と `w*C*` の導出
- ICBS: `complete: conditional`, `optimal: true`。same-cost BP と optimal CBS 構成に基づくが、
  ICBS 固有の完全性定理は無いため conditional
- EECBS: `complete: unknown`, `optimal: false`, `bounded_suboptimal: true`。
  p.5 式 (2) の選択条件を evidence にし、完全性は推測しない

unknown が残る手法は 59 件から 58 件へ減った。

### 9–10. 論文・公開実装との差異とブラウザ版の簡略化

- CBS は論文の SOC / conflict / FIFO と CAT tie-break を採用。
  `libmultirobotplanning` の CT heap は cost のみ
- BCBS の単一 `w` は既定で `sqrt(w)` ずつ配分し、extra で `wH,wL` を明示可能
- ICBS の分類は MDD の代わりに等価な 2 child の最短 cost を直接 probe
- EECBS は §3 の基礎版。公開 implementation の §4 BP / PC / symmetry / WDG は含めない
- 全手法に有限 `maxHorizon`、共有 expansion budget、timeout、AbortSignal、trace 上限を追加

### 11. 未対応部分

positive constraint / disjoint splitting、MA-CBS と coupled low level、ICBS merge-and-restart、
EECBS §4 の relaxed bypass / PC / rectangle・corridor・target symmetry / adaptive WDG、
following conflict、diagonal、disappear at goal、無限 horizon。

### 12. 次の推奨バッチ

Batch 3: `pbs` / `pibt` / `winpibt`。

---

## 2026-07-27 — Batch 3 PBS / PIBT / winPIBT の独立実装（担当: Codex）

### 1. 対象アルゴリズム

`pbs`、`pibt`、`winpibt` の 3 件を Solver registry へ追加した。PBS / PIBT は
author-maintained implementation の固定 fixture と比較できたため `runnable / reference-validated`、
winPIBT は登録 checkout に対応 source が無いため `runnable / paper-faithful` とした。

### 2. 参照した論文と節

- `pbs-aaai-2019` PDF pp.2–5, 7: Prioritized Planning の限界、Algorithm 2、UpdatePlan、
  low-level の incomparable / lower 2 段 CAT tie-break、PT depth、4% が実験観測であること
- `pibt-aij-2022` PDF pp.8–13: Algorithm 1、priority inheritance / backtracking、
  candidate ordering、Theorem 1、one-shot MAPF wrapper、reachability と simultaneous goal の区別
- `winpibt-2019` PDF pp.3–7: dodgeable / disentangled、Algorithms 1–2、Lemmas 4.1–4.2、
  Theorem 4.3、classical MAPF の timestep failure

PDF の該当ページを画像で目視し、Marker fidelity も 3 本個別に実行した。PBS marker は既知どおり
Figure 5–8 が欠落し語数比 78% なので、Algorithm 2 と実験記述は PDF を直接使用した。
各 `metadata.yaml` に algorithm / theorem と公開実装との差異を記録した。全文の行単位照合ではないため
`verification.checked_against_pdf` は `false` のままにした。

### 3. 参照した公開実装

- `.references/pbs` commit `d7b91fa5...`（USC Research License、`copy_allowed: false`）を
  read-only で確認し、`/tmp` へ CMake build した。3×2 empty swap を Space-Time A\* mode で実行し、
  browser PBS と success、SOC=6、makespan=4、path validity を比較した
- `.references/pibt2` commit `faab5b9...`（MIT）で priority / candidate tie-break を確認。
  `grid-pathfinding` と GoogleTest submodule 欠落により CMake configure は失敗した。winPIBT source は無い
- `.references/pypibt` commit `a3c97f6...`（MIT）を NumPy 環境で直接実行し、満杯 2×2 clockwise
  rotation で browser PIBT と success、makespan=1、configuration 列、path validity を比較した。
  環境に pytest が無いため repository test suite 全体は未実行

第三者コードは転記していない。したがって `THIRD_PARTY_NOTICES.md` の変更は無い。

### 4. 実装したファイル

- `src/solvers/pbs/low-level.ts`: higher paths の hard reservation と、incomparable / lower paths の
  lexicographic CAT を持つ PBS 専用 Space-Time A\*
- `src/solvers/pbs/pbs.ts`: priority DAG、PT DFS、Algorithm 2 UpdatePlan、initial partial order option
- `src/solvers/pibt/pibt.ts`: `eta+epsilon`、1-step recursive inheritance / backtracking、one-shot wrapper
- `src/solvers/pibt/winpibt.ts`: provisional / committed paths、disentangled gap constraint、
  exact-horizon time-expanded A\*、retroactive inheritance、suffix revoke、Algorithm 2 の `kappa`
- `src/solvers/registry.ts`、`src/solvers/limits.ts`: 3 Solver 登録と candidate event の trace 分類
- `src/content/algorithms/{pbs,pibt,winpibt}.mdx`: 日本語解説を `reviewed` へ更新
- `docs/notes/implementation/{pbs,pibt,winpibt}.md`: 実装前調査と検証結果
- `docs/sources/algorithms.yaml`、各 paper metadata、`IMPLEMENTATION_STATUS.md`

全 Solver は `checkLimits()`、deterministic `context.random()`、`context.now()`、AbortSignal、timeout、
global expansion limit、finite horizon、trace limit、structured result を使用する。

### 5. 追加・更新したテスト

`tests/unit/batch3-solvers.test.ts` を追加し、`tests/unit/invariants.test.ts` と E2E を更新した。

- registry / metadata / unsupported rules / option validation
- PBS の author implementation 固定 fixture 比較、PT / DAG / replan event
- fixed Prioritized Planning が失敗する off-center recess を PBS の sibling branch が解く例
- joint-state BFS は解を確認するが PBS が失敗する中央 recess の既知の不完全例
- PIBT の満杯 2×2 rotation、inheritance、backtrack、graph condition 外の horizon failure
- winPIBT `window=1` と PIBT の path 一致、`window>1` の provisional reservation
- 3 Solver の決定性、timeout、node limit、AbortSignal、input / trace limit
- 10 seed の反復 `checkPaths()` と simulator 選択肢の E2E

既存テストは削除・skip・弱体化していない。

### 6–7. テスト・ビルド結果

```text
sources:validate  errors=0 warnings=6
format:check      All matched files use Prettier code style!
lint              0 problems
typecheck         0 errors（86 files、既存 Astro deprecation hints 22）
test              125 passed（10 files）
build             62 pages
e2e               26 passed（Chromium desktop + mobile）
```

warning 6 件は Batch 2 終了時と同じ既知警告で、今回の変更による追加は無い。

### 8. 理論保証と manifest への書き戻し

- PBS: `complete: unknown` のまま。Algorithm 2 の PT depth `O(M^2)` は completeness theorem ではない。
  `optimal: false`, `bounded_suboptimal: false` を維持し、p.7 の 4% は経験的観測と evidence に明記
- PIBT: `complete: conditional`, `optimal: false`, `bounded_suboptimal: false` を維持。
  条件付き値は Theorem 1 の graph condition と「goal stay を要求しない変種」の reachability であり、
  classical MAPF completeness ではない
- winPIBT: `complete: unknown → conditional`。p.7 Theorem 4.3 の dodgeable graph + finite window の
  individual reachability を evidence に記録。`optimal: unknown` は推測せず維持し、cost bound は false

winPIBT は optimal が unknown のため、「unknown を含む algorithm」の総数は 58 のまま。

### 9. 論文と公開実装との差異

- PBS 公開実装は conflict queue、conflict selection variants、SIPP option を持ち、README 上も
  original experimental code ではない。browser は paper Algorithm 2 の closure scan を直接実装
- pibt2 は elapsed の次に initial distance、pypibt は start-goal distance を fractional priority に使う。
  browser は paper の unique `eta+epsilon` を採用
- 公開実装は unresolved candidate ties を shuffle する。browser は seed から固定 tie rank を一度作る
- winPIBT は登録 checkout に source が無く、paper Algorithms 1–2 だけを根拠に独立実装

### 10. ブラウザ版で簡略化した部分

- 3 手法とも 4 近傍、following 許可、stay at goal の one-shot MAPF に限定
- PBS low level は infinite time から有限 `maxHorizon` へ置換。公開版の SIPP / conflict variants は未対応
- PIBT は iterative goal update / PIBT+ / decentralized execution を含まない
- winPIBT の window は全 agent 共通の固定値。adaptive per-agent window、task allocation、
  iterative goal 到達時の reservation 短縮、decentralized 2w-hop communication は未対応

### 11. 未対応部分

PBS の無限 horizon 非存在証明と full benchmark、PIBT / winPIBT の iterative MAPF / MAPD wrapper、
dodgeable graph condition の自動判定、PIBT+、adaptive winPIBT、公開 winPIBT implementation との比較。

### 12. 次の推奨バッチ

Batch 4: `icts` / `mstar` / `push-and-swap` / `push-and-rotate`。

---

## 2026-07-27 Batch 3 レビュー後の横断修正（Claude Code）

Batch 3 のレビューで見つかった、バッチ単体ではなくサイト横断の欠陥 4 件を直した。

### 1. Solver の警告が画面に一切出ていなかった

`Simulator.tsx` が `result.warnings` をどこからも読んでいなかった。
Batch 1〜3 で書いてきた但し書きが全部死んでいた。

これが問題なのは、不完全な手法（PIBT / winPIBT / PBS / 優先順位付き計画）が
「解が見つかりませんでした」だけを表示すると、読者が「解が存在しない」と受け取るため。
その区別は warnings にしか書かれていない。指標表の直下に警告リストを出すようにした。

e2e に回帰テストを追加（Narrow Corridor × PIBT で警告文言を検査）。

### 2. PBS が優先度木を枯渇させたとき、但し書き無しで no-solution を返していた

反例: 幅 5 の通路に待避ポケットが 1 つだけある入れ替え問題。
CBS は sum of costs 11 で解くが、PBS はどちらの全順序でも高優先度側が
最短経路を占有するため枯渇する。PIBT / winPIBT は同種の状況で警告を出していたので、
PBS だけ不揃いだった。

あわせて `sawHorizonCutoff` がルート計画の分岐で設定直後に return され、
警告に到達しない死にコードになっていたのを直した。

### 3. `runInline` が `input.options` を無視していた

`RunSolverInput` は `options` を宣言しているのに `runInline` は第 2 引数しか読まず、
`runInline({ solverId, scenario, options })` が黙ってデフォルトで走っていた。
`runSolver` 側は正しくマージしていたのでサイトの挙動は正常。
影響は `tests/unit/invariants.test.ts` で、`windowSize` / `maxExpansions` の
指定が効かないままテストが通っていた（誤った pass ではなく、意図より弱いテスト）。

### 4. 保証表の「方式」が全ページで「不明」

`AlgorithmLayout` が `architecture` prop を渡しておらず、37 ページすべてで
無意味な行が出ていた。値の出どころを `algorithms.yaml` に一本化し、
未確認なら行ごと省くようにした。書く場合は `architecture_evidence` を必須にし、
`validate-sources.mjs` がエラーで止める（guarantees と同じ扱い）。

原論文で確認できた 3 件だけ記入した。

| id      | 値                    | 根拠                                                                                                                         |
| ------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| cbs     | centralized           | cbs-aij-2015 p.3 §2.6「The scope of this paper is limited to centralized approaches」                                        |
| pibt    | decentralized-capable | pibt-aij-2022 p.2「PIBT has a high potential for decentralized implementations」                                             |
| winpibt | centralized           | winpibt-2019 p.4「We explain winPIBT in centralized fashion ... winPIBT with decentralized fashion faces some difficulties」 |

★ PIBT と winPIBT で値が違う点に注意。PIBT は分散実装への適性を主張しているが、
winPIBT は論文自身が集中型として提示し、分散化には困難があると述べている。
PBS は原論文に自らの方式を述べた記述が無いため未記入のまま。

---

## 2026-07-27 — Batch 4: ICTS / M* / Push and Swap / Push and Rotate（担当: Codex）

### 1. 対象アルゴリズム

- ICTS（Increasing Cost Tree Search）
- M*（Subdimensional Expansion）
- Push and Swap
- Push and Rotate

4 手法とも `runnable / paper-faithful`。Push and Rotate は会議版 Algorithms 1–4 と、同論文が
primitive の詳細として参照する著者 thesis Algorithms 4.1.1–4.2.11 まで実装した。

### 2. 参照した論文と節

- `icts-ijcai-2011`: PDF pp.1-6、§2、§4-6、§8、Algorithm 1
- `mstar-aij-2015`: PDF pp.7-10, 16-31、§3-5.1、Algorithms 1-2、Theorem 1
- `push-and-swap-ijcai-2011`: PDF pp.2-7、§1.2、§2-3.2、§5、Algorithms 1-3、Theorem 3.1
- `push-and-rotate-aamas-2013`: PDF pp.1-8、§2-4.3、§6、Algorithms 1-4、Theorem 1
- Push and Rotate 会議論文 p.6 が primitive の完全仕様として参照する Boris de Wilde の 2012 TU Delft
  MSc thesis、Algorithms 4.1.1-4.2.11（調査用に `/tmp` へ取得し、リポジトリには同梱していない）

4 本とも marker fidelity check は「要確認 0」。Algorithm / Theorem の内容とページは PDF image / text を
人手で確認したが、全文の行単位照合ではないため metadata の `checked_against_pdf` は false のまま。

### 3. 参照した公開実装

- `hog2` `af9d42d0`: 登録 checkout に ICTS source が見つからず、比較対象にできなかった
- `libmultirobotplanning` `4c75fa20`: M* source が無かった
- `public-cppmomapf` `80bc...`: multi-objective MOM* であり basic M* の oracle にはしなかった
- `pibt2` `faab5b91`: Push and Swap の priority / clear / compression の差異を閲覧。
  `grid-pathfinding` と `googletest` submodule 未取得で CMake configure 失敗
- `push-and-rotate-cbs-pp` `bba48f17`: LICENSE 不在なので read-only。CMake configure は成功したが、
  現行 GCC で `node.h` の `size_t` header 不足により build 失敗。source は修正しなかった

第三者コードは転記しておらず、`THIRD_PARTY_NOTICES.md` の変更は無い。

### 4. 実装したファイル

- `src/solvers/joint/icts.ts`: ICT BFS、exact-cost MDD、k-agent MDD DFS、pairwise pruning
- `src/solvers/joint/mstar.ts`: basic M*、individual policy、limited neighbors、collision-set backpropagation
- `src/solvers/push/decomposition.ts`: iterative Tarjan、subproblem merge / agent assignment / priority propagation
- `src/solvers/push/engine.ts`: 検査付き逐次 move、4-stage clear、multipush、transactional swap、exchange / reverse、空き／満杯 cycle rotate
- `src/solvers/push/solvers.ts`: Push and Swap と Push and Rotate の API wrapper、plan / resolve、guard / warnings
- `src/lib/model/types.ts`, `src/solvers/limits.ts`: Batch 4 の可視化 event と trace level
- `src/solvers/registry.ts`: 4 Solver を登録
- partial solver を registry 登録だけで runnable 表示へ格上げしていた共通 status 判定を、
  `AlgorithmStatus.astro`、`AlgorithmCard.astro`、比較表、roadmap で修正

### 5. 追加・更新したテスト

`tests/unit/batch4-solvers.test.ts` を追加し、`tests/unit/invariants.test.ts` と E2E を更新した。

- ICTS / M* の小規模 2-agent instance を `jointStateOptimalSumOfCosts()` と比較
- `checkPaths()`、SOC / makespan 再計算、determinism
- ICT node / MDD / collision-set / push primitive trace
- horizon、timeout、node limit、AbortSignal、input limit、trace limit、unsupported rules
- Push の空き 2 vertex guard、agentOrder validation、失敗時の非存在非証明 warning
- Push and Rotate の空き／満杯 cycle、dense swap、isthmus subproblem / priority、空き 2 個だけの二部屋 graph
- `jointStateBfs()` で存在を確認した 3×2 の 36 configuration、random 6 seed の Batch 4 不変条件
- simulator 選択肢と runnable badge の E2E

既存テストは削除・skip・弱体化していない。

### 6-7. テスト・ビルド結果

```text
sources:validate  errors=0 warnings=6（既知 warning のみ）
marker fidelity   4 papers / 要確認 0
format:check      All matched files use Prettier code style!
lint              0 problems
typecheck         0 errors（92 files、既存 Astro deprecation hints 22）
test              186 passed（11 files）
build             62 pages
e2e               30 passed（Chromium desktop + mobile）
```

### 8. 理論保証と manifest への書き戻し

- ICTS: `complete: unknown`, `optimal: true`, `bounded_suboptimal: false`。
  p.1 Abstract / p.2 §4 は optimal を明示するが unsolvable instance の有限停止 theorem は未確認
- M*: `complete: true`, `optimal: true`, `bounded_suboptimal: false`。
  p.30 Theorem 1 を直接確認
- Push and Swap: `complete: conditional → false`, `optimal: false`, `bounded_suboptimal: false`。
  IJCAI 2011 Theorem 3.1 の主張に対し、AAMAS 2013 が同一条件内の反例を提示
- Push and Rotate: `complete: conditional`, `optimal: false`, `bounded_suboptimal: false`。
  p.5 Theorem 1 の条件は各 connected component に空き vertex 2 個以上。browser safety limit による
  `timeout` / `node-limit` は保証の対象外

unknown を含む algorithm 数は 58 / 77 のまま（ICTS の complete を推測せず維持）。

### 9. 論文と公開実装との差異

- ICTS / M* は登録 checkout に対応する basic solver source が無く、独立 oracle 比較だけを行った
- M* の edge collision は中間 vertex を追加せず、site transition 上の edge-swap として直接検出
- `pibt2` Push and Swap は start-goal distance priority と plan compression を使うが、browser は input order
  と primitive の逐次 frame を採用。IJCAI 版 clear の欠落ケースは後続一次資料の 4-stage clear で補正
- Push and Rotate 公開実装は LICENSE 不在なので閲覧のみ。コードを修正・転記していない
- Push and Rotate Algorithm 4 の trail `q` は、証明が要求する displaced finished agent の位置を保持するため、
  本文の「通過 path」に合わせ top-level planning の始点を含めた

### 10. ブラウザ版で簡略化した部分

- 4 手法とも 4 近傍 unit-cost grid と one-shot MAPF に限定
- ICTS は MDD を ICT node ごとに再構築し、ID / AIJ 拡張版の reuse / sparsification を含まない
- M* は basic variant のみ。recursive / OD / EPEM / inflated M* は含まない
- Push and Swap は smoothing / parallel compression を含まない
- Push and Rotate は一般 graph import、solution smoothing、connected component の並列 schedule を含まない

### 11. 未対応部分

一般 graph file import、solution smoothing、論文 benchmark map 全件の再現、公開実装との固定 output 比較。
公開実装比較は上記 build blocker のため未完了で、`reference-validated` とはしていない。

### 12. 次の推奨バッチ

Batch 5 の `lacam` / `lacam-star`。

---

## 2026-07-27 Batch 4 レビュー後の修正（Claude Code）

### 1. 反証による `false` を規則として明文化した

`push-and-swap` の `complete: false` は正しい判断だが、規則が追いついていなかった。
`algorithms.yaml` ヘッダと `SOURCE_POLICY.md` 第 7 条は `false` を
「原論文が保証しないと明示している」とだけ定義していたため、
規則だけを読んだ人が「原論文 p.4 Theorem 3.1 は完全と主張しているのだから
`false` は誤り」と判断して差し戻せてしまう状態だった。

両方に「原論文は主張しているが後続の一次資料が反証している」場合を追記し、
次を必須にした。

- `guarantee_evidence` に原論文の主張と反証資料の**両方**をページ番号つきで書く
- 反証の根拠は一次資料に限る（二次資料・ブログ・issue コメントは不可）
- 解説ページでも両論文を併記する

### 2. 実装状態の判定を 1 箇所へ集約した

同じ式が 4 ファイルに重複していた。

- `src/components/AlgorithmCard.astro`
- `src/components/sources/AlgorithmStatus.astro`
- `src/pages/compare.astro`
- `src/pages/roadmap.astro`

Batch 4 で Codex が直した「registry にある partial が実行可と表示される」
過大主張は、まさにこの重複が生んだものだった（ICBS が該当）。
`src/lib/implementation-state.ts` に `implementationStateOf` /
`isRunnable` を切り出し、4 箇所をすべて置き換えた。

`tests/unit/implementation-state.test.ts` で規則そのものを固定した。
特に「registry に無い手法が runnable / partial と表示されることは無い」を
全 77 手法に対して検査しており、過大主張の一般形を封じている。

---

## 2026-07-27 — Batch 5: LaCAM / LaCAM*（担当: Codex）

### 1. 対象アルゴリズム

- LaCAM（Lazy Constraints Addition search for MAPF）: `runnable / paper-faithful`
- LaCAM*: `runnable / reference-validated`

### 2. 参照した論文と節

- `lacam-aaai-2023`: PDF pp.1–4、§2、§3.1–3.3、Algorithm 1、Theorem 1
- `lacam-star-ijcai-2023`: PDF pp.1–5、§2.1–2.3、§3–4、Algorithms 1–4、Theorem 1

両論文とも marker fidelity check は「要確認 0」。疑似コード、目的関数、保証は PDF image / text を
人手で確認した。全文の行単位照合ではないため metadata の `checked_against_pdf` は false のまま。

### 3. 参照した公開実装

- `lacam0` `3153c980`: MIT。`argparse` submodule 未取得で CMake configure 不能。LaCAM* rewiring、random restart、PIBT swap、hindrance を含む後年の統合版として参照のみ
- `lacam2` `61a4c40c`: MIT。`argparse` / `googletest` submodule 未取得で CMake configure 不能
- `pylacam` `864a158f`: MIT。main branch は PIBT を random action selection に置換した最小 LaCAM*。環境に無い `loguru` だけを実行時の無作用 stub にし、公式 3×2 fixture を変更なしで実行

第三者コードは転記しておらず、`THIRD_PARTY_NOTICES.md` の変更は無い。

### 4. 実装したファイル

- `src/solvers/lacam/solvers.ts`: LaCAM Algorithm 1 と LaCAM* Algorithm 3、共通 PIBT 型 generator、制約 BFS、graph rewiring、安全弁、構造化 result
- `src/lib/model/types.ts`: `rewire-configuration` event
- `src/solvers/limits.ts`: LaCAM event の detailed trace 分類
- `src/solvers/registry.ts`: 2 Solver を登録
- `src/content/algorithms/lacam.mdx`, `lacam-star.mdx`: reviewed 解説、教材用疑似コード、差異、実験
- `docs/papers/*lacam*/metadata.yaml`: PDF 目視確認記録

### 5. 追加・更新したテスト

`tests/unit/batch5-solvers.test.ts` を追加し、implementation-state と E2E を更新した。

- 3×2 detour swap の `checkPaths()`、SOC / makespan、5 seed の決定性
- 2×1 edge swap の OPEN exhaustion と no-solution
- configuration / low-level / lazy constraint / rewiring / incumbent events
- LaCAM* と `jointStateOptimalSumOfCosts()` の比較（goal 離脱の無い fixture のみ）
- timeout、node limit、AbortSignal、max path length、input / rule / option / trace guard
- simulator 選択肢、runnable badge、sum-of-loss と表示 SOC の注意を desktop / mobile E2E で確認

既存テストは削除・skip・弱体化していない。

### 6–7. テスト・ビルド結果

```text
sources:validate  errors=0 warnings=6（開始時と同じ既知 warning）
marker fidelity   2 papers / 要確認 0
format:check      All matched files use Prettier code style!
lint              0 problems
typecheck         0 errors（96 files、既存 Astro deprecation hints 22）
test              200 passed（13 files）
build             62 pages
e2e               30 passed（Chromium desktop + mobile）
```

### 8. 理論保証と manifest への書き戻し

- LaCAM: `complete: true`, `optimal: false`, `bounded_suboptimal: false`。AAAI 2023 p.3 Theorem 1 と p.1 の sub-optimal の記述へ evidence を更新
- LaCAM*: `complete: true`, `optimal: conditional`, `bounded_suboptimal: false`。IJCAI 2023 p.4 Algorithm 3 lines 27–30 / Theorem 1 に基づき、OPEN exhaustion 時だけ optimal、中断時は sub-optimal と明記
- LaCAM* の保証対象は非負の累積 transition cost。ブラウザ内部は論文の sum-of-loss であり、サイト共通 `metrics.sumOfCosts` の最適性ではない

unknown を含む algorithm 数は 58 / 77 のまま。2 手法とも保証値は既に確定済みだったため、今回 PDF で evidence と条件を精密化した。

### 9. 論文と公開実装との差異

- LaCAM Algorithm 1 は既知 configuration を捨てるが、論文 §3.3 と `lacam0` は再挿入を改善として使う。ブラウザ LaCAM は基本構造を保つため再挿入しない
- `lacam0` は LaCAM* / LaCAM3 由来の改善を統合するが、ブラウザは LaCAM と LaCAM* の境界を分離
- `pylacam` main は random action generator、ブラウザは原論文 §3.3 / Algorithm 2 に沿う PIBT 型 priority inheritance generator
- 公開実装の random tie / restart に対し、ブラウザは `context.random()` から作る固定 rank で同一 seed を再現

### 10. ブラウザ版で簡略化した部分

- 4 近傍 unit-cost grid、following conflict 許可、stay-at-goal の one-shot MAPF に限定
- LaCAM* Algorithm 4 の PIBT swap、random restart、LaCAM3 engineering / post-processing は未対応
- Dijkstra の等 cost parent は既存を保持し、strict improvement だけ rewiring
- max path length、timeout、max expansions を追加。cutoff 結果は完全性・最適性の対象外

### 11. 未対応部分

一般 graph file、diagonal / following 禁止 / disappear-at-goal、複数 optimization metric の UI、
Moving AI benchmark 全件、submodule 取得後の C++ 公式実装との固定比較。

### 12. 次の推奨バッチ

Batch 6 の `mapf-lns` / `mapf-lns2` / `rhcr`。

---

## 2026-07-31 Batch 6（Codex）

### 1. 対象アルゴリズム

`MAPF-LNS`、`MAPF-LNS2`、`RHCR`。

### 2. 参照資料

- `mapf-lns-ijcai-2021`：§2、§4、§5.1–5.3、Algorithm 1–2、pp.1–4。
- `mapf-lns2-aaai-2022`：Definition 1–2、§3–5、Algorithm 1–3、Theorem 1–2、pp.1–5。
- `rhcr-aaai-2021`：§3–4、Algorithm 1、Examples 1–3、§4.4、結論、pp.3–8。
- 参照実装：`Jiaoyang-Li/MAPF-LNS` commit `95785de`、`Jiaoyang-Li/MAPF-LNS2` commit `1369823`、`Jiaoyang-Li/RHCR` commit `d009a3b`。いずれも USC Research License のため転記していない。

### 3. 実装ファイル

- `src/solvers/lns/solvers.ts`
- `src/solvers/registry.ts`
- `tests/unit/batch6-solvers.test.ts`
- `docs/notes/implementation/mapf-lns.md`
- `docs/notes/implementation/mapf-lns2.md`
- `docs/notes/implementation/rhcr.md`

### 4. 実装内容

- MAPF-LNS：初期 PP、agent/map/random neighborhood、予約表付き repair、accept-if-better、ALNS weight、LNS events。
- MAPF-LNS2：個別最短 path の衝突 plan、collision-pair / failure / random neighborhood、CP 非増加 repair、暫定 path の返却。
- RHCR：goal queue、planning window `w`、replanning period `h`、`h` step commit、throughput / average service time / pending task metrics。
- 3 手法すべてに `checkLimits`、timeout、node limit、AbortSignal、決定的 seed、構造化結果、finish event を実装。

### 5. テスト

`tests/unit/batch6-solvers.test.ts` に registry、validity、LNS repair、LNS2 CP repair、determinism、RHCR w/h、metric、rule/options validation を追加した。

### 6. 理論保証と差異

- MAPF-LNS：complete unknown、optimal false、bounded-suboptimal false。IJCAI 2021 p.1 の no-guarantee。
- MAPF-LNS2：complete false、optimal false、bounded-suboptimal false。AAAI 2022 p.1 abstract の no-theoretical-guarantees。
- RHCR：complete false、optimal false、bounded-suboptimal unknown。AAAI 2021 §4.4 p.6 の incomplete 例と結論 p.8。
- ブラウザ版は SIPPS 全機能、EECBS/CBS/PBS windowed variants、online warehouse task assigner、Poisson arrivals を簡略化し、既存 Space-Time A* と固定 goal queue を用いる。
- 参照実装は 3 件とも CMake ビルドに成功。Moving AI の先頭 2 agent 固定ケースでは、公式 MAPF-LNS が SOC 52、公式 MAPF-LNS2 とブラウザ版 MAPF-LNS2 が SOC 64（ブラウザ makespan 36）だった。公式 RHCR は KIVA / SORTING の短時間起動が timestep 0 で SIGSEGV となり、数値比較は未成立。いずれもコードは転記していない。

### 7. 品質ゲート

最終結果：`npm run sources:validate` は errors=0 / warnings=6、`npm run format:check`、`npm run lint`、`npm run typecheck`（0 errors / 22 hints）、`npm test`（15 files / 211 tests）、`npm run build`（62 pages）、`npm run test:e2e`（32 tests）がすべて通過した。

### 8. 未解決・次工程

SIPPS の hard/soft safe interval dominance、MAPF-LNS の全 repair operator、RHCR の warehouse 固有オンライン task assigner は未対応。次は Batch 7（Hungarian / Min-Cost Max-Flow / Gale-Shapley / CBM / CBS-TA）。

---

## 2026-08-01 Batch 6 レビュー後の修正（Codex）

Claude Code のレビューで確認された公開上の不整合を修正した。

- RHCR は `one-shot-mapf` の既定プリセットも一要素の固定 goal queue として実行できるようにし、シミュレータへ `planning window w` / `replanning period h` の入力を追加した。オンライン到着でないことは `simplified-behavior` 警告で明示する。
- RHCR の低レベル探索を goal 到達まで延長し、予約・衝突解消だけを最初の `w` step に限定した。`w` より遠い goal、`w < h` の入力、actual arrival time − release time の service time をテストした。
- MAPF-LNS / MAPF-LNS2 の初期計画失敗・探索打ち切り・衝突を残した返却には「これは解の非存在の証明ではありません」という警告を付けた。LNS の ALNS 更新を論文式（改善量を近傍サイズで割らない）に合わせ、近傍選択を Fisher–Yates にし、agent tabu を一巡ごとにクリアする。
- RHCR の fidelity を `educational` に下げ、Multi-Label A*、distance 下界による goal 補充、progress-potential による window 拡張、warehouse task assigner が未実装であることをノートとページへ明記した。
- PDF と照合した引用ページを修正した（RHCR Algorithm 1 p.4、結論 p.8、MAPF-LNS2 Definition 1 p.1）。

追加・更新したテストは `tests/unit/batch6-solvers.test.ts` と `tests/e2e/site.spec.ts`。最終ゲートは sources:validate errors=0/warnings=6、format check、lint、typecheck 0 errors/22 hints、unit 214 passed、build 62 pages、E2E 34 passed。

未対応の論文機能は上記の通りであり、RHCR の complete / optimal を主張しない。MAPF-LNS と MAPF-LNS2 も不完全な anytime 手法で、失敗結果は解なしの証明ではない。次は Batch 7（Hungarian / Min-Cost Max-Flow / Gale-Shapley / CBM / CBS-TA）。

---

## 2026-08-29 未照合だった領域を掃き出し、実装ミス 3 件を直した（Claude Code）

有界準最適の照合で残っていた穴（TAPF の最適性、lifelong、大きい盤面）を
実際に叩いた。3 件出た。うち 2 件は同じ型だった。

### 1. 時空間 A* が、全プリセットで必ずエラーになっていた

`space-time-astar` は `requireSingleAgent: true`（単一エージェント専用。
原論文どおりの低レベル探索で、CA* と混同させないための設計判断）だが、
**`canSolve` を定義していなかった**。`solversFor` は `canSolve` の無い Solver を
素通しするので、UI の候補に常に出る。one-shot のプリセットは 8 件すべて
2 体以上だったので、選ぶと 100% エラーだった。

`canSolve` は TAPF / MAPD の Solver だけが使っていて、one-shot 側は
誰も使っていなかった。

★ 受け付けない形は `solve` の中でエラーにするのではなく `canSolve` で断ること。
solve の中でしか弾かないと、画面には選択肢として出てしまう。

直し方は 2 つで対。`createSequentialSolver` が `requireSingleAgent` のときに
`canSolve` を張るようにし、あわせて **`single-agent` プリセットを追加**した。
`canSolve` だけ足すと、1 体の盤面がひとつも無いので時空間 A* が画面から
完全に消える。壁を迂回する 9×7 の盤面にして、直線距離 8 に対し SOC 18 になる。

### 2・3. 有効な解を持ちながら「時間切れ」と表示していた（LaCAM* / MAPF-LNS）

```text
lacam-star outcome=timeout failureReason=limit-exceeded
           paths=10  到達=10/10  衝突=0  規則違反=0
```

10 体全員が goal に着いた衝突ゼロの完全な解を持ちながら `timeout` を返していた。
大きい盤面 12 例中 8 例。MAPF-LNS も同じで、初期計画が complete なのに
改善ループの上限で `node-limit` を返していた（上限を絞ると全プリセットで再現）。

どちらも**打ち切った理由を outcome に入れていた**のが原因。anytime 手法なので
「探索を完遂していない」のは事実だが、それは outcome ではなく warnings で
言うこと。LaCAM* の最適性が OPEN 完了時の主張である
（lacam-star-ijcai-2023 p.4 Algorithm 3 lines 27-30 が OPEN 完了時を optimal、
interruption 時を sub-optimal と分ける）ことは従来どおり警告で伝えており、
そこへ打ち切りの理由（実行時間の上限 / 展開数の上限 / 経路長の上限 / 利用者の中断）を
足した。`failureReason` は「outcome が solved 以外のときの分類」なので外した。

★ outcome は「何が起きたか」であって「なぜ探索をやめたか」ではない。
混ぜると、利用者には成功が失敗に見える。

### 常設テスト

`solver-invariants.test.ts` に「プリセットと Solver の噛み合わせ」を追加した。
プリセット × 候補に出る全 Solver を、探索上限 100 と 1000 で一周する。

★ 上限を絞るのは速さのためだけではない。**打ち切りが起きない条件では
2 つ目の検査が空振りする。** 既定の上限で一周すると 135 秒かかるうえ、
小さいプリセットは全部完走してしまうので誤報を検出できない。
上限 100 なら 0.5 秒で、しかも打ち切りが起きる。

1. 候補に出した Solver が invalid-scenario で落ちないこと（1 の一般形）
2. 全員が goal に着いた衝突ゼロの経路を持つなら solved を名乗ること（2・3 の一般形）

旧挙動を固定していた既存テスト 2 件（`batch5-solvers` と `solvers`）を
新しい契約に書き換えた。E2E にも「時空間 A* は 1 体の盤面でだけ選べて、
そこでは解ける」を追加した。

### 調べて問題が無かったもの

- **CBS-TA / MCMF / CBM の TAPF 最適性** — ランダム 12 盤面で SOC オラクルと全一致。
  既存テストはプリセット 1 件だけだったので、ここは新たに広げて確認した範囲。
- **RHCR の lifelong** — 40 盤面で solved 40 / 衝突 0。最初 20 例中 3 例が
  timeout に見えたが、生成器が 2 体に同じ最終 goal を割り当てていたためで
  （片方が居座るので原理的に解けない）、RHCR 側の問題ではなかった。
- M* の timeout 4/12、ICTS の node-limit 1/12 は 10 体規模では想定どおり。

### まだ照合していない主張

- `sipp` の complete/optimal、`pibt` / `winpibt` / `push-and-rotate` の
  条件付き完全性、`lacam-star` の eventually optimal。
- **lifelong-mapf は UI から到達できない。** goal 列は `goalSequences` という
  `Scenario` 型にもプリセットにも JSON にも無いキーを `buildGoalQueues` が
  キャストで読んでいるだけで、手でオブジェクトを組まない限り動かせない。
- ルール変種（edge-swap / following を切った場合）。

最終ゲート: sources:validate errors=0/warnings=14、format check、lint、
typecheck 0 errors、unit 363 passed、build 65 pages、E2E 56 passed。

---

## 2026-08-29 有界準最適（BCBS / ECBS / EECBS）の係数を照合した（Claude Code）

前回の検証で積み残していた「有界準最適の係数を検査していない」への対応。
`cost ≤ w × 最適` を参照実装（構成グラフ上の A*）と突き合わせた。

### 何を見たか

保証は「係数 w 以内に収まる」という約束なので、約束そのものと、
約束の根拠として画面に出している数字の両方を見る必要がある。

1. 解のコストが `w × 最適` 以内か（約束そのもの）
2. 報告している `lowerBound` が本当に下界か（最適値を上回っていないか）
3. 報告している `suboptimalityBound` が w 以内か

2 が要る。下界を大きく見せれば比はいくらでも小さく見えるので、
下界が偽なら 3 の数字は無意味になる。

### 結果: 違反ゼロ

3 手法 × 係数 {1.1, 2, 3} × 25 盤面。**上の 3 つとも破れなし。**
実際の比の最大は w=3 でも 1.400 で、係数には遠く届いていない。

BCBS が報告する比は `sqrt(w)` でほぼ一定になる（w=2 で 1.414、
w=3 で 1.732）。これは `lowerBound = 根ノードのコスト / w_L`、
`w_H = w_L = sqrt(w)` から出る値で、**弱いが正しい下界**である。
解が実際には最適でも 1.414 と出るのは過大主張ではなく、
「その下界からはここまでしか言えない」という意味。ECBS / EECBS は
focal の下界を使うぶん締まっていて、最適だと分かる盤面では 1.000 を返す。

### 「w を無視していないか」は展開ノード数で見る

★ ここが今回いちばん考えたところ。上の 3 検査は、**w を完全に無視して
毎回最適解を返す実装でも全部通る**。安全側の検査なので当然だが、
それだけでは「有界準最適として動いている」ことの証拠にならない。

最初は「w を広げたときに最適から離れた解を返した回数」で見ようとしたが、
小さい盤面では 25 例中 1〜2 例しか出ない。手法ごとに 1 件以上を要求すると
盤面生成をいじっただけで落ちる、意味の薄い判定になる。

代わりに展開ノード数を見た。focal を広げれば早く打ち切れるので、
w を渡して展開が減らないなら w は高レベル探索に届いていない。

```text
        w=1    w=3
bcbs    450 →  307
ecbs    450 →  307
eecbs   450 →  307
```

余裕が大きく、盤面をいじっても壊れにくい。あわせて **w=1 なら最適解に戻る**
（focal が open と一致する）ことも手法ごとに確認した。ここがずれるなら
focal の条件式が間違っている。「最適から離れた解を返した回数」は
全体で 1 件以上とだけ要求し、主たる判定は展開数に置いた。

### 残り

`tests/unit/solver-invariants.test.ts` に 8 件（計 47 件）として常設。
`suboptimalityFactor` を渡された最適解法（CBS）が「使わない」と警告する
ことも固定した。lifelong-mapf の掃き出しはまだしていない。

最終ゲート: sources:validate errors=0/warnings=14、format check、lint、
typecheck 0 errors、unit 360 passed、build 65 pages、E2E 54 passed。

---

## 2026-08-29 全 Solver をランダム入力で検証した（Claude Code）

「他のアルゴリズムにも実装ミスがあると思うので、一旦すべて複数 seed や
複数条件で検証した方が良いのでは」という指摘への対応。そのとおりだった。
プリセットだけ見ていた間は全部通っていたのに、ランダムに振ると 3 件出た。

### 何を検査したか

手法によらず成り立つべきことを、ランダム生成した盤面で回した。

- 報告した `conflicts` が実際の衝突と一致する
- `solved` なら経路が構造的に妥当（開始位置・連続性・goal 到達・壁を通らない）
- `solved` なら衝突 0（衝突を解消しないと宣言した BFS / A* は除く）
- `solved` なら未処理タスク 0
- `metrics` が返した経路と一致する
- 同じ入力・同じ seed なら同じ結果
- _*最適を主張する手法は参照実装（構成グラフ上の A*）と同じ SOC を返す_*
- **完全性を主張する手法は、参照実装が解ける盤面を必ず解く**
- **CBM の makespan は全探索割当と一致する**

### 見つかったもの

**1. RHCR: goal を通過しただけで「到達」と数えていた**

`firstArrivalTime` は窓の中で一度でもそのセルに居れば到達とする。
lifelong / MAPD では正しい（通りがかりに配達する）が、one-shot MAPF で
「解けた」と言うには最後にそこへ留まっている必要がある。通過で queue から
外すと、その後の episode で agent は現在地に park し、goal から離れた場所で
止まったまま solved になっていた。one-shot のときだけ「窓の終わりにその
セルに居ること」を条件にした。

**2. RHCR: 動けない agent を、動く agent より後に予約していた**

goal queue が空になった agent はその場から動けない。これを rank 順に混ぜて
処理すると、先に計画した agent が「まだ予約されていない停止中の agent」の
上を通る経路を引く。goal に着いて止まった agent の上を別の agent が
通り抜ける衝突が実際に出ていた。動かないものを先に予約するようにした。

本来の RHCR は lifelong なので「もう goal が無い agent」が存在せず、
この順序問題は起きない。one-shot へ持ち込んだこちら側の都合。

**3. 最小費用最大流: 6×4・2 体で無限ループしていた（最も重い）**

Bellman-Ford の緩和に「等コストなら from の小さいほうを採る」タイブレークが
あり、距離が変わらないのに `previous` を差し替えていた。これで predecessor に
閉路ができる（A の親が B、B の親が A）。経路を遡るループは source に着くまで
回るので、閉路に入ると永久に返らない。

```text
6×4 空きマップ、a1(5,3) a2(4,3)、target (0,1) (3,2)
  修正前: 返らない（timeoutMs=10000 も効かない）
  修正後: 3〜12ms
```

**timeoutMs が効かない**のは `checkAbort` が horizon ループの外にしか無いため。
ブラウザではタブごと固まる。厳密改善のときだけ predecessor を張り替える形に直し、
念のため経路を遡るループにも番人を置いた。決定性は反復順序で足りるので
タイブレークは要らない。

この無限ループのせいで TAPF の掃引自体が完走できず、他の検査も止まっていた。

### 結果

```text
one-shot   25 盤面 × 25 手法   違反なし
           最適性（CBS/ICBS/ICTS/M*）   参照実装と全一致
           完全性（CBS/ICBS/M*/LaCAM/LaCAM*/BCBS/ECBS）   全て解けた
TAPF       12 盤面 × 3 手法    違反なし
           CBM の makespan     全探索と全一致
MAPD       20 盤面 × 7 手法    違反なし
```

`tests/unit/solver-invariants.test.ts` に 39 件として残した。約 10 秒で回る。
深く探すときは盤面数を増やして手元で回す（探索時は one-shot 60・MAPD 60 で回した）。

★ 決め打ちのプリセットだけで保証を確かめない。この 3 件はどれも
プリセットでは再現しなかった。

最終ゲート: sources:validate errors=0/warnings=14、format check、lint、
typecheck 0 errors、unit 352 passed、build 65 pages。

---

## 2026-08-29 TP の詰みを直し、操作パネルを並べ替えた（Claude Code）

「アルゴリズムのすぐ下に再生を置いてほしい」「実行結果を実行ボタンのすぐ下に
出してほしい」「Token Passing が well-formed マップで時間切れになっておりおかしい」
という 3 点の指摘への対応。

### 1. TP の詰み（指摘は正しかった）

プリセットでは再現しなかったので、ランダムな well-formed 入力 114 例で探索した。
**TP は 22 例（19%）で詰んでいた。** well-formed なら必ず解けるはず
（mapd-tp-tpts-central-2017 p.4 Theorem 3）なので、手法ではなく実装の問題。

原因は実行ループの取りこぼし。

```text
t26  a1 が (8,1) で t2 を配達 → その場に立っている
     直後に t1（pickup も (8,1)）を割り当てられる
t27  a1 は (8,1) を離れる  ← pickup 判定は移動後にしか走らないので記録されない
     pickedUp=false のまま delivery (12,1) に着いても配達が成立せず、
     t1 を抱えたまま delivery 上に居座る。他の agent も t1 を取れない
```

**配達を終えた地点が、次に割り当てられたタスクの pickup と同じ**だと起きる。
割当の時点ですでに pickup 地点に立っているならその場で拾うようにした。
基本ループと拡張ループの両方。

### 2. TPTS が「解が求まりました」なのに衝突を残していた（別件・既存）

同じ探索で見つけた。TPTS は 114 例中 11 例で衝突を残していた。
1 の修正前後で同数なので、私の変更が原因ではない既存のバグ。

task を奪ったとき、奪われた側の経路を token から**消したまま**にしていた。
この timestep に後から計画する agent からは old owner が居ないものとして見え、
その居場所を通る経路を引く。old owner が新しい task を取れなければその場に
留まるので、実際には重なる。

正しい最小状態は「いまの場所に留まり続ける」。そう置いてから新 owner を
計画すれば新 owner はそこを避ける。避けられないなら奪取を見送る
（奪えないより、衝突するほうが悪い）。

### 結果

well-formed な 114 例での失敗数：

```text
                修正前          修正後
mapd-greedy        3               3   （保証なしの対照。想定どおり）
token-passing     22               0
tpts               6（衝突 11）     0（衝突 0）
central            0               0
lns-pbs            0               0
lns-wpbs           2               2   （論文どおり完全性の保証なし）
rmca               0               0
```

残る失敗は**保証を持たない 2 手法だけ**になった。

★ プリセット 4 つでは全部通っていたので気付けなかった。
`tests/unit/mapd-guarantee.test.ts` を追加し、ランダムな well-formed 入力
30 例で「完全性を主張する手法は解ききる」「solved なら衝突 0」を固定した。
決め打ちのプリセットだけで保証を確かめない。

### 3. 操作パネルの並べ替えと実行結果の表示

「再生」を「アルゴリズム」の直下へ移した。実行の結末（解が求まった／時間切れ／
残存衝突／未処理タスク）を実行ボタンのすぐ下に出すようにした。指標表は下のほうに
あり、押した人の目線から遠い。

★ solved でも衝突や未処理が残っていれば「うまくいった」扱いにしない。
BFS / A* は衝突を解消しないので solved のまま重なりを残す。緑一色にすると
誤読させる。実画面で確認：

```text
open-grid/cbs   [ok]   解が求まりました
open-grid/bfs   [warn] 解が求まりました／残存衝突 4 件
narrow-corridor/cbs [warn] 時間切れ
open-grid/rhcr  [ok]   解が求まりました 但し書きが 1 件あります（下の「指標」を参照）
```

最終ゲート: sources:validate errors=0/warnings=14、format check、lint、
typecheck 0 errors、unit 313 passed、build 65 pages、E2E 54 passed。

---

## 2026-08-28 シミュレータをドラッグで編集できるようにした（Claude Code）

「操作性が悪い。ドラッグ＆ドロップで動かせるほうが良い」という指摘を受けた対応。

### 何が不便だったか

編集はすべて「モードを選んでクリック」だった。とくに悪かったのが 2 点。

- **「開始」「目標」モードが、最後に追加したエージェントにしか効かない。**
  途中のエージェントの開始・目標を触る手段が無かった。
- **壁は 1 セルずつクリック。** 細い通路を作るのが現実的でない。

### 直したこと

盤上のもの（エージェントの開始位置・目標、タスクの pickup / delivery、
TAPF の target）を**掴んで動かせる**ようにした。モードの切り替えは要らない。
モードは「何も無いセルを押したとき何を置くか」の意味に変えた。

壁は**押したままなぞると続けて塗れる**。最初に押したセルの状態で塗るか消すかを
決め、以後は同じ操作を続ける。

判定は `src/components/simulator/drag.ts` に純関数として置いた。
「どこを掴めるか」「どこへ置けるか」は盤面の意味に関わる判断で、
コンポーネントに埋めるとテストできない。

★ 置ける条件はモデル側の制約から来る。ここで緩めないこと。

- 壁の上には置けない
- エージェントの開始位置は重ねられない（同時刻に同じセルは vertex conflict）
- TAPF の target は重複できない（cbm-tapf-aamas-2016 p.2 が unique targets と
  定義し、validateScenario も同じ条件を見ている）
- タスクの pickup / delivery は**重なってよい**。論文側に禁止は無く、
  実際 mapd-parking プリセットは 2 つの delivery が同じセルにある

★ 重なっているセルは手前のものから掴む（エージェント本体 → 目標 → タスク地点）。
奥のものを掴みたければ手前をどける。open-grid は開始位置と目標が
設計上重なっているので、この規則が効く場面がある。

### キーボードでも同じことができる

ドラッグをポインタ専用にすると、支援技術の利用者だけが古い操作に取り残される。
矢印で選び、Enter で掴み、矢印で運び、Enter で置く。Escape で元に戻す。

あわせて、**フォーカスした時点で (0,0) を選ぶ**ようにした。以前は選択が空で、
最初の 1 打が「どこを選んでいるか分からないまま 1 つずれる」動きになり、
(0,0) 自体を選べなかった。

CSS の `touch-action` を `manipulation` から `none` にした。前者のままだと
タッチでドラッグしたときにブラウザのスクロールへ持っていかれる。

### 実画面での確認

```text
エージェント        (0,0) → (4,3)        掴んで移動できる
目標                (11,11) → (8,2)      a4 をどけたあと掴める（重なりの規則どおり）
壁                  0 → 8 マス           1 回のドラッグで
壁の上へ落とす      直前の通行可能セルで止まる
```

### テスト

`tests/unit/simulator-drag.test.ts` 12 件（掴める対象、重なりの優先順位、
壁・重複の拒否、動かした結果が validateScenario を通ること、
全プリセットで「掴めるセル ⇔ 壁を塗れないセル」が一致すること）。
`site.spec.ts` に 2 件（ドラッグでの移動、キーボードでの移動）。

★ e2e は盤面の余白を計算に入れること。`computeViewport` はセルを正方形に
保ったまま中央へ寄せるので、canvas の幅をセル数で割ると別のセルを掴む。
最初これで落ちた。

最終ゲート: sources:validate errors=0/warnings=14、format check、lint、
typecheck 0 errors、unit 300 passed、build 65 pages、E2E 50 passed。

---

## 2026-08-03 LNS-wPBS の時間窓をシミュレータから触れるようにした（Claude Code）

Codex が Batch 9 のレビュー修正で LNS-wPBS に rolling window を実装した。
検証したところ窓は正しく動いていた（探索は goal まで伸び、予約と衝突解消だけが
窓の内側。24 step 先の goal も既定 w=10 で解ける）。

ただし**既定 w=10 では 6 プリセット全部で LNS-PBS と結果が同じ**で、
差が出るのは w=2〜4 のときだけだった。そこへはユニットテストからしか
到達できず、サイト上では相変わらず「同じ挙動の 2 手法」に見えていた。

シミュレータに `時間窓 w` の入力を足した。既定 10 は論文の実験設定
（mg-mapd-iros-2022 p.6「We set the time window of LNS-wPBS to w = 10
timesteps.」）。LNS-PBS 側には出さない（窓を使わないため）。

実画面での確認（`mapd-well-formed`）:

```text
LNS-PBS          解が求まりました  svc 11.0  未処理 0   （窓の入力は出ない）
LNS-wPBS w=10    解が求まりました  svc 11.0  未処理 0
LNS-wPBS w= 4    時間切れ          svc 10.5  未処理 1
LNS-wPBS w= 2    時間切れ          svc  9.5  未処理 1
```

w を狭めると LNS-wPBS だけが詰まる。同 p.5 が言う
「incomplete because there is no guarantee that the agents can reach their
goal locations in a finite number of timesteps」の理由が、画面で確かめられる
ようになった。動かせないと 2 手法の違いを説明しようがないので、
つまみ自体が説明の一部になっている。

`site.spec.ts` に 1 件追加（LNS-PBS に窓の入力が無いこと、既定が 10 であること、
w=2 にすると解が求まらなくなること）。

なお Codex の報告表で `mapd-not-well-formed` の throughput が `.0045` に
なっていたが、実測は `.0149`（Batch 9 前と同値）だった。コードは正しく、
報告の転記ミス。既存 4 手法に退行は無い。

最終ゲート: sources:validate errors=0/warnings=14、format check、lint、
typecheck 0 errors、unit 288 passed、build 65 pages、E2E 46 passed。

---

## 2026-08-02 Batch 8 レビュー後の追記（Claude Code）

Codex の Batch 8 修正を受けて、こちらで 3 点手を入れた。

### 1. `MapdStepOutput` を拡張した

Codex の「既存 API の制約で TPTS の奪い取りができない」という報告は正しかった。
`assign` で他エージェントのタスクを奪えるようにし、`unassign` を足した。

★ **奪える条件はループ側で強制する。** 持ち主がまだ pickup へ向かっている途中
（`pickedUp === false`）のときだけ。mapd-tp-tpts-central-2017 p.4 §4.2 の
「as long as that agent is still moving to the pickup location」を、
戦略の書き方に関わらず守るため。成立時の `swap-task` もループが出す。

### 2. `mapd-task-swap` を well-formed な盤面へ置き換えた

Codex 版は t2 の delivery を通路上（10,1）に置いたため条件 (c) を 7 組で破り、
well-formed でなくなっていた。**TPTS の利点を見せる盤面が TP/TPTS の保証の
対象外**では説明にならない。

endpoint を alcove（y=0 / y=2）だけに置き、通路 y=1 には 1 つも置かない形へ変えた。
これで条件 (c) が自動的に成り立つ。結果は well-formed かつ TPTS が改善する。

```text
mapd-greedy / TP / CENTRAL   svc 11.00  makespan 16  swap 0
tpts                         svc  9.00  makespan 12  swap 1
```

論文の傾向（service time は TPTS < TP）とも向きが一致した。

### 3. MLA* の回帰テストが偽陽性だった

「resting tail を検出する」テストがプリセットの座標を直に使っていたため、
プリセットを差し替えたら pickup が壁の上に来て、**resting tail と無関係な理由で
`null` になり通り続けていた**。バグが再発しても気付けない。

盤面を自前で持つ形に変え、同じ入力を「占有あり / 占有なし」の 2 通りで回して
差が出ることを見るようにした。

### 確認したこと

Codex の衝突修正が本物であることを、こちらが最初に書いた
「t1 の pickup と t2 の delivery が同じセル」という盤面で回帰確認した。
4 手法とも衝突 0。プリセットを避けたのではなく `mla-star.ts` が直っている。

最終ゲート: sources:validate errors=0/warnings=11、format check、lint、
typecheck 0 errors、unit 273 passed、build 64 pages、E2E 44 passed。

---

## 2026-08-02 MAPD の実行ループを作った（Claude Code）

Batch 8（TP / TPTS / CENTRAL / MLA\*）は 4 手法とも `problem_types: [mapd]` で、
時間発展する実行系が無いと載らない。TAPF のときと同じ構図なので先に土台を作った。

### 1. モデル: endpoint（mapd-tp-tpts-central-2017 p.2 §3.2）

`Scenario.parkingEndpoints` を足し、`src/lib/model/mapd.ts` で論文の集合を導出する。

- `V_ep` = エージェント初期位置 ∪ 全タスクの pickup/delivery ∪ 追加 parking
- `V_tsk` = 全タスクの pickup/delivery
- `V_ep \ V_tsk` = non-task endpoint（永久に留まってよい場所）

`parkingEndpoints` は 3 項目のうち第 3 項だけなので、これを V_ep として
直接使わないよう型のコメントに書いた。

### 2. well-formed 判定（同 p.2 Definition 1）

3 条件を `checkWellFormed` で検査する。(c)「任意の 2 endpoint 間に他の
endpoint を通らない経路がある」は、両端以外を壁扱いした BFS で対ごとに見る。

★ **well-formed は十分条件であって必要条件ではない**（同 p.2）。
「満たさない ＝ 解けない」と書かないよう、警告も UI 文言もそう作った。
TP / TPTS の保証（同 p.4 Theorem 3）は well-formed な入力についての主張なので、
そうでない入力での失敗を手法の欠陥と読ませないことも同時に書いている。

★ 対の数が上限を超えたら (c) を省略し `checked: false` を返す。そのとき
`wellFormed` は必ず `false`。判定していないものを well-formed と呼ばないため。

### 3. 実行ループ

`runMapdLoop` は時間を進める係だけを担当し、割当も経路計画も決めない。
決めるのは `MapdStrategy`。Batch 8 は戦略だけ書けば載る。

1 ステップの順序（release → 戦略 → 移動 → pickup/delivery 判定）を固定した。
変えると service time が 1 ずれるので、手法を差し替えても比較できるように
ここで決め切っている。

★ ループは 1 歩が隣接か現在地かだけを検査し、**衝突は直さない**。
避けるのは戦略の仕事で、避けられなかったことは `conflicts` に出す。
ループが黙って直すと、不完全な手法が完全に見えてしまう。

★ service time は releaseTime 起点（同 p.2 §3.1）。割当時刻でも pickup 時刻でもない。
release を 5 遅らせても値が変わらないことをテストで固定した。

### 4. ベースライン `mapd-greedy`

**論文手法ではない。** `algorithms.yaml` には登録せず、
`IMPLEMENTATION_STATUS.md` にその旨を書いた。TP との違いは endpoint 規律で、
手が空いたエージェントを退避させずその場に居座らせる。作業地点や通路の上で
止まると後続を塞ぐので、**詰まる様子そのものが TP の Property 2（同 p.4）の
存在理由の説明になる**。これが置いた理由。

作る途中で一度、現在地しか予約しない実装にしていて、通路の正面衝突で
両者が譲らず固まった。予約を「計画した経路全体」に変えて解消した。

実測:

```text
mapd-well-formed       solved   3/3  平均 service time 9.0  throughput 0.214
mapd-not-well-formed   timeout  1/2  平均 service time 8.0  throughput 0.015
```

### 5. UI

well-formed 判定を MAPD セクションに出す（endpoint の内訳つき）。
指標に平均 service time / throughput / 未処理タスクを足した。MAPD は
sum of costs や makespan で測る問題ではないので、別行にしている。
盤面では non-task endpoint を破線の円で描き、作業地点（□ pickup / △ delivery）
と描き分けた。TaskGenerator はエージェント初期位置を作業地点にしないよう直した
（初期位置が task endpoint 側へ移ると条件 (b) を自動的に壊すため）。
「Solver が未実装」の注記を消した。

### テスト

`tests/unit/mapd.test.ts` 16 件（endpoint の分割、Definition 1 の (b)/(c)、
上限超過、JSON 往復、service time の起点、イベント順、警告の有無、
拒否、決定性、kind 絞り込み）。`site.spec.ts` に 2 件。

`solvers.test.ts` の「すべてのプリセットが妥当」は TAPF に続いて MAPD でも
エージェントに `goal` が無いので、タスクの pickup/delivery を見るよう直した。

最終ゲート: sources:validate errors=0/warnings=8、format check、lint、
typecheck 0 errors、unit 258 passed、build 63 pages、E2E 44 passed。

### 次

Batch 8 は `MapdStrategy` を実装するだけで載る。引き継ぎは
`docs/notes/implementation/mapd-loop.md` の末尾に書いた。要点は
token を明示的に持つこと、CENTRAL は保証を持たないこと（同 p.1 abstract）、
MLA\* を先に実装すると TP の低レベルがきれいになること。

---

## 2026-08-01 TAPF（目標割当）の入り口を作った（Claude Code）

Batch 7（Hungarian / MCMF / Gale-Shapley / CBM / CBS-TA）は割当問題の
手法群だが、シミュレータに割当を扱う入り口が無く、そのままでは載せられない。
先に土台を作った。

### 1. どちらの入り口か

マニフェストを見ると「割当の入り口」は 2 つに割れる。

|           | `problem_types`                | 中身                                                    |
| --------- | ------------------------------ | ------------------------------------------------------- |
| Batch 7   | `assignment` / `tapf` / `flow` | エージェントに紐付かない goal 集合を割り当ててから MAPF |
| Batch 8/9 | `mapd`                         | pickup→delivery のタスクが時刻とともに到着し続ける      |

先に必要なのは前者なので、TAPF を作った。MAPD の実行ループは別途。

### 2. モデル（cbm-tapf-aamas-2016 p.2 §2.1）

`TeamSpec { id, agentIds, goals }` を足し、`Scenario.teams` を追加した。
論文の定義をそのまま不変条件にしている。

- チームの target 数はチームのエージェント数と**同数**
- チーム内の割当は 1 対 1 写像（順列）
- 同チーム内は交換可能、チームをまたいだ交換は不可

`validateScenario` で検査する。この同数条件は実装の都合ではなく、
「各 target がちょうど 1 体に訪問される」の前提なので、崩れると
最適性の議論ができなくなる。

同 p.1 が述べるとおり、チーム 1 つなら匿名 MAPF、チームが人数分あれば
通常の MAPF になる。プリセットはその両端と中間が見えるように 3 つ置いた。

TAPF では `agents[].goal` を**設定しない**。割当が解の一部なので、
書いてしまうと「もう割り当て済み」に見える。

### 3. Solver を `Scenario.kind` で絞るようにした

`metadata.supports` は前から宣言されていて `registry.solversFor()` も
あったのに、UI が使っていなかった。そのため RHCR（lifelong 専用）が
one-shot プリセットでも選べて必ずエラーになる状態が一度できている。
TAPF / MAPD を足すと同じことがまた起きるので、ここで塞いだ。
「どの kind でも、絞り込んだ手法は全てその kind に対応している」を
テストで固定した。

### 4. 目的関数を必ず言うようにした

`SolverResult.objective` を足し、画面に「最小化した量」として出す。

TAPF はここが特に危ない。**CBM は makespan を最小化し
（cbm-tapf-aamas-2016 p.2）、CBS-TA は sum of costs を最小化する
（cbs-ta-aamas-2018 p.2）。** CBS-TA 論文 p.1 自身が
「CBM は makespan を最小化するが、idle time の最小化には合わない」と
両者を区別している。画面は SOC も makespan も出すので、
黙っていると「表示されている数値はどれも最適」と読まれる。
LaCAM* の sum-of-loss と同じ罠。

### 5. 動く Solver を 1 つ同梱した

`tapf-baseline`（全探索割当 + CBS）。チーム内の割当を全通り試して
CBS で解き、makespan 最小を返す。**論文手法ではない**ので
`algorithms.yaml` には登録せず、`IMPLEMENTATION_STATUS.md` に
その旨を書いた。置いた理由は 2 つ。

- 入り口だけ作って中身が空だと、RHCR と同じ「選べるのに必ずエラー」になる
- Batch 7 で CBM の最適性を突き合わせる相手が要る（小規模なら確実に最適）

なお、この方法の scalability の悪さは手法の性質で、
cbm-tapf-aamas-2016 p.2 が「全割当を探索して最適解を求めるやり方」を
scalability に難があるものとして名指ししている。なぜ CBM が要るのかの
対照として機能する。組合せ数 5040 を超える入力は構造化エラーで拒否する。

### 6. 描画

チーム target は破線の四角、割当済みは実線＋エージェント名。
エージェントの goal（実線のリング）とは描き分ける。割当前と割当後を
同じ見た目にすると「もう決まっている」ように見えるため。

### テスト

`tests/unit/tapf.test.ts` 13 件（不変条件、JSON 往復、kind 絞り込み、
最適割当、目的関数の警告、決定性、拒否）。
`tests/e2e/site.spec.ts` に 2 件（TAPF を解くと割当と目的関数が出る、
プリセットを戻すと手法一覧も戻る）。

`solvers.test.ts` の「すべてのプリセットが妥当」は全エージェントに
`goal` がある前提だったので、TAPF では team の target を見るよう直した。

最終ゲート: sources:validate errors=0/warnings=6、format check、lint、
typecheck 0 errors/22 hints、unit 229 passed、build 62 pages、E2E 40 passed。

### 次

MAPD の実行ループ（Batch 8/9 用）はまだ無い。Batch 7 の CBS-TA は
チームではなく割当行列を使うので、実装時に `TeamSpec` の拡張が要る。
詳細は `docs/notes/implementation/tapf-baseline.md` の引き継ぎ節。

---

## 2026-08-01 Batch 6 レビュー後の修正 2（Claude Code）

上記の修正で残っていた 2 点。どちらも RHCR。

### A. RHCR だけ、失敗時の不完全性警告が入っていなかった

MAPF-LNS / MAPF-LNS2 には「解の非存在の証明ではありません」が入ったが、
`solveRhcr` は `addIncompleteWarning` を呼んでいなかった。
UI 既定（w=8, h=2）で全プリセットを回すと、`swap-conflict` と `cross` が
`no-solution` を返し、警告は「one-shot Scenario を…」の 1 件だけだった。

`swap-conflict` は CBS が sum of costs 11 で解く。RHCR の windowed 優先順位付き
計画が詰まっただけなのに、画面には「解が求まりませんでした」しか出ない。
`algorithms.yaml` が論文の結論（p.8）を根拠に `complete: false` と書いている
手法なので、MAPF-LNS / MAPF-LNS2 と同じ扱いにした。

`addIncompleteWarning` に `nature` を足し、RHCR は anytime 手法ではないので
「完全性を保証しない枠組み」と名乗る。打ち切り理由は `rhcrFailureDetail` で
3 通りに分ける（運転時間切れ / window 内で計画できず / 実行上限）。

修正後、solved 以外の 3 プリセットすべてで警告が出ることを確認した。

### B. RHCR の既定 horizon が `w * 4` で、UI から変えられなかった

`w` は衝突を解消する先読みの長さであって運転時間ではない（原論文 §4、p.3）。
`w * 4` を既定にしていたため、既定 w=8 では 32 step しか回らず、
`warehouse` プリセットが RHCR と無関係な理由で `pending=1` になっていた。

```text
warehouse  w=8  h=2  horizon=既定(w*4=32) -> timeout  pending=1
warehouse  w=8  h=2  horizon=200          -> solved   pending=0
warehouse  w=20 h=2  horizon=既定(w*4=80) -> solved   pending=0
```

しかも表示は「時間切れ」なので、10 秒の実行時間制限に見える。
既定を `defaultMaxTime(scenario)`（マップ面積と goal 距離から決まる）にし、
シミュレータに「シミュレーション horizon」入力（空欄 = 自動）を足した。
horizon を使い切ったときの警告も「実行時間の上限ではなく運転時間の上限」と
書き分けた。修正後 `warehouse` は solved / pending=0 になる。

`narrow-corridor` は horizon をいくら伸ばしても pending=1 で残るが、
これは論文 §4.4（p.6）が説明する deadlock そのもので、A の警告が付く。

### テスト

`batch6-solvers.test.ts` に 2 件（RHCR の不完全性警告、既定 horizon が w に
依存しないこと）、`site.spec.ts` に 2 件（horizon 入力が空欄で出ること、
swap-conflict で警告が画面に出ること）を追加。

最終ゲート: sources:validate errors=0/warnings=6、format check、lint、
typecheck 0 errors/22 hints、unit 216 passed、build 62 pages、E2E 36 passed。

---

## 2026-07-27 Batch 5 レビュー後の修正（Claude Code）

### 1. LaCAM* が打ち切って返した解を「最適ではない」と言うようにした

予算を絞った LaCAM* は `node-limit` / `timeout` を返しつつ **経路も返す**。
シミュレータは `setResult` を無条件に呼ぶのでその経路は再生できる。
それにもかかわらず、最適でないことを述べる警告が無かった。

LaCAM* の最適性は OPEN を空にしたときの主張であり
（lacam-star-ijcai-2023 p.4 Algorithm 3 lines 27-30 が OPEN 完了時を optimal、
user interruption 時を sub-optimal と分岐する）、途中経過の解には及ばない。
`SOURCE_POLICY.md` 第 8 条がこの手法を名指ししている以上、ここは言わねばならない。

`solutionResult` で outcome が solved でない場合に警告を出すようにした。
実画面での確認:

```text
結果          時間切れ
sum of costs  147
⚠ 簡略化      探索を完遂する前に打ち切ったため、これは途中経過の解であって
              最適解ではありません。LaCAM* の最適性は OPEN を空にした場合の保証です。
```

### 2. sum-of-loss の但し書きを、実際に食い違うときだけ出すようにした

以前は solver 開始時に無条件で push していたため、両目的関数が一致する
（= goal を離れる agent がいない）解でも必ず出ていた。検証した 5 インスタンスは
すべて一致しており、警告は毎回無関係だった。結果として利用者は毎回
関係ない警告を 1 件見せられ、指摘 1 の重要な警告を一度も見ないことになる。

返した経路から sum-of-loss を計算し、`metrics.sumOfCosts` と異なるときだけ、
両方の値を添えて出すようにした。

なお `batch5-solvers.test.ts` の「OPEN exhaustion まで探索し…」は
`simplified-behavior` の警告が常に出ることを期待していたが、同テストの
コメント自身が「この fixture では両目的関数が一致する」と書いている。
期待値を「但し書きは 1 つも出ない」へ反転させた。

### 3. 実装状態の引き下げ規則を、バッチ進行で壊れないテストにした

`implementation-state.test.ts` の「registry に無いなら planned へ引き下げる」は
lacam を例に使っていたため、Batch 5 で lacam が実装された時点で成立しなくなり、
バッチ登録の確認テストへ置き換えられて規則の検査が消えていた
（登録確認は `batch5-solvers.test.ts` に既にある）。

規則を純関数 `resolveImplementationState(declared, registered)` として切り出し、
4 状態 × 2 の全 8 組合せを固定した。どの手法が実装済みかに依存しないので、
以後のバッチで同じことは起きない。

---

## 2026-08-01 Batch 7（Codex）

### 実装

- `ImplementationStatus` に `library` を追加し、「内部実装あり（単体では実行不可）」と表示する状態を AlgorithmStatus / Card / compare / roadmap / manifest / index へ反映。
- `MapfSolver.canSolve(scenario)` と registry/UI の形状フィルタを追加。CBM は teams 形状、MCMF は 1 チーム、CBS-TA は teams または assignment 行列だけを受ける。
- `AssignmentSpec`（target ID + rectangular allowed matrix）を Scenario と JSON 往復へ追加。既存 `TeamSpec` の equal-count invariant は維持。
- `src/lib/flow/min-cost-max-flow.ts`、`src/lib/assignment/hungarian.ts`、`src/lib/assignment/gale-shapley.ts` を独立実装。
- `src/solvers/tapf/team-flow.ts`、`cbm.ts`、`cbs-ta.ts`、`mcmf-solver.ts` を追加。CBM は makespan、CBS-TA は sum of costs を `objective` に設定。
- `targetAssignments.teamId` を optional、`targetId` を追加し、renderer / simulator に generic assignment の fallback を実装。

### 資料・検証

- 5 本の PDF を再確認し、`algorithms.yaml` の 5 手法から `unknown` を除去。Hungarian / Gale-Shapley は内部 library 状態。
- `libMultiRobotPlanning` は MIT を確認し、assignment 固定行列の cost/割当（275, `[t3,t2,t1,t0]`）を実行ファイルと一致確認。`cbs_ta` は yaml-cpp 不足でビルドできず、固定 YAML は TypeScript 側で再構成して期待 SOC 6/6/5 を照合。
- `docs/notes/implementation/{min-cost-max-flow,hungarian-method,gale-shapley,cbm,cbs-ta}.md` と 5 ページの MDX を追加。CBS-TA の N≠M では余剰 agent を parking goal へ、余剰 target を未割当として明記。

### 未解決

論文どおりの遅延 K-best search forest、ECBS-TA、MCMF の flow 原典（Ford-Fulkerson 等）は未調査のまま。参照実装の CBS-TA executable は yaml-cpp 導入なしでは再実行できない。

### 最終品質ゲート

- `npm run sources:validate`: errors=0 warnings=8
- `npm run format:check`: passed
- `npm run lint`: passed
- `npm run typecheck`: 0 errors（Astro の既存 z deprecation warning のみ）
- `npm test`: 17 files / 240 tests passed
- `npm run build`: 63 pages built
- `npm run test:e2e`: 40 tests passed（chromium / mobile）

---

## 2026-08-01 Batch 7 レビュー修正（Codex）

- CBS-TA の N>M で、実装どおり余剰 agent を parking cell へ退避する説明へ修正。論文 p.2 の条件 (2) には goal-less agent が存在しないこと、著者参照実装の `potentialGoals: []` ケースに倣うサイト拡張であることを公開ページ・実装ノート・コードコメントへ記載。
- 退避時に agent 数、target 側 SOC、退避側 SOC、合計を示す `simplified-behavior` warning を追加。6×3 固定ケースで `5 + 7 = 12` をテスト固定。
- CBS-TA の `fidelity` を `educational` へ変更。search forest と on-demand K-best assignment は未実装で、全候補列挙であることを manifest / status / MDX / note に反映。
- `canSolve` の XOR を変数化して可読性を改善。library 状態と Hungarian / Gale-Shapley 実体の対応テストを追加。Gale-Shapley のページ番号体系（PDF 物理ページ）も明記。

### 修正後の品質ゲート

- `npm run sources:validate`: errors=0 warnings=8
- `npm run format:check`: passed
- `npm run lint`: passed
- `npm run typecheck`: 0 errors（既存 Astro `z` deprecation warning のみ）
- `npm test`: 17 files / 242 tests passed
- `npm run build`: 63 pages built
- `npm run test:e2e`: 40 tests passed

---

## 2026-08-02 Batch 8（Codex）

### 実装

- `src/solvers/mapd/mla-star.ts` に、pickup 前後の label と token path の衝突判定を持つ MLA* を追加。
- `src/solvers/mapd/strategies.ts` に明示的 token を持つ共通 strategy を追加。TP / TPTS / CENTRAL が Path1 / Path2 と MLA* を共有し、TPTS は未 pickup assignment を距離比較して交換する。
- `src/solvers/mapd/solvers.ts` と registry に TP / TPTS / CENTRAL を追加。`runMapdLoop` は変更していない。
- HBH は単独 Solver ではなく Hungarian + MLA* の内部 assignment strategy として実装。MLA* / HBH は `library` 状態にした。

### 資料・保証

- `mapd-tp-tpts-central-2017` の Algorithm 1/2、Theorem 3/5、CENTRAL §5、結論を PDF で再確認。
- TP / TPTS は well-formed 前提の条件付き完全性、CENTRAL は完全性・最適性なし、MLA* / HBH は保証定理を確認できず unknown と `guarantee_evidence` に記録。
- 数値傾向（CENTRAL < TPTS < TP の service time）と保証の有無を解説に併記し、混同しないようにした。

### 解説・テスト

- `src/content/algorithms/{mla-star,token-passing,tpts,central,hbh}.mdx` と各実装ノートを追加・更新。
- `tests/unit/batch8-mapd.test.ts` に、3 Solver の well-formed 完了、非 well-formed 警告、TPTS swap、MLA* label 探索、HBH 内部 strategy を追加。

### 品質ゲート

- `npm run sources:validate`: errors=0 warnings=11
- `npm run format:check`: passed
- `npm run lint`: passed
- `npm run typecheck`: 0 errors（既存 Astro `z` deprecation hints のみ）
- `npm test`: 19 files / 265 tests passed
- `npm run build`: 64 pages built
- `npm run test:e2e`: 44 tests passed（chromium / mobile）

### 未対応

- TPTS は拡張された `MapdStepOutput.assign` で前 step の未 pickup task も奪う。full path 到達時刻による論文の細かな比較は true-distance 比較へ簡略化。
- CENTRAL の論文どおりの二段 CBS、MLA* / HBH の大規模実験環境、分散通信は未対応。

### 2026-08-02 Batch 8 レビュー修正（Codex）

- `src/solvers/mapd/mla-star.ts` の goal 判定に resting tail の衝突検査を追加。既存 token path の終端に `goalBehavior: stay` で残る agent がいる場合、後続 path がそのセルを通る解を受理しないようにした。指摘 1 の原因は低レベル MLA* が「goal 到達後も stay する token path」を将来時刻まで照合せず、短い新規 path の終端を無限占有として扱っていなかったこと。
- `src/solvers/mapd/strategies.ts` は TPTS の候補に前 step の未 pickup carrying task を含め、pickup までの true distance が old owner より厳密に短い場合だけ `assign` を返す。loop が `swap-task` を発火し、old owner の token path を一時的に外して同じ step に別 task / Path2 を再計画する。strategy から `swap-task` は出さない。
- Path2 を assignment より先に評価し、delivery endpoint 上の free agent を non-task endpoint へ退避。`mapd-parking` を長い後続 task が先に割当済みになる形へ調整し、TP/TPTS/CENTRAL と greedy の経路差を固定した。
- `tests/unit/batch8-mapd.test.ts` に全 MAPD preset × (`mapd-greedy`, TP, TPTS, CENTRAL) の solved 衝突ゼロ、`mapd-task-swap` の loop swap と TP/TPTS 差、`mapd-parking` の Path2 差を追加。TPTS の same-step テストは一意 delivery の確認へ変更した。
- 実装ノート、TPTS MDX、solver metadata、IMPLEMENTATION_STATUS を新 API と実装動作に更新。旧記録の「過去 timestep swap 未対応」はこのレビューで解消済み。

### レビュー修正後の品質ゲート

- `npm run sources:validate`: errors=0 warnings=11
- `npm run format:check`: passed
- `npm run lint`: passed
- `npm run typecheck`: 0 errors（既存 Astro `z` deprecation hints 22 件）
- `npm test`: 19 files / 273 tests passed
- `npm run build`: 64 pages built
- `npm run test:e2e`: 44 tests passed（chromium / mobile）

---

## 2026-08-02 Batch 9（Codex）

### 実装

- `TaskSpec.goals`、`AgentSpec.capacity`、`MapdStepInput.carryingTasks`、`MapdStepOutput.assignSequence` を後方互換で追加。既存 capacity 1 / 単一 goal のループ分岐と時刻順序は維持。
- `src/solvers/mapd/batch9.ts` に LNS-PBS / LNS-wPBS / RMCA の共通 task-sequence planner、`src/lib/assignment/regret-insertion.ts` に RMCA 内部部品を追加。
- `SolverMetrics.totalTravelDelay` と `objective: total-travel-delay` を追加し、RMCA は service time と TTD を分離して返す。
- `mapd-capacity` と `mapd-multi-goal` プリセット、Batch 9 の単体テストを追加。

### 資料・保証

- `mg-mapd-iros-2022` p.1 abstract、p.3 Algorithm 1、p.5 Theorem 1 を PDF で確認。LNS-PBS は well-formed MG-MAPD 条件付き complete、LNS-wPBS は no completeness guarantee と manifest へ反映。
- `rmca-ral-2021` p.2–4 を確認。RMCA の目的は TTD。完全性・最適性の保証は確認できないため unknown のまま。
- regret insertion の古典的原典は確認できず、保証は unknown。単体 Solver ではなく library 状態。

### 未対応

- 論文の全 anytime LNS 近傍、PBS priority-tree、LNS-PBS dummy-path 完全性、RMCA の potential-assignment heap / top-v collision repair は教育用に簡略化。
- 公開実装は未特定のため固定ケース照合なし。

### 品質ゲート

- `npm run sources:validate`: errors=0 warnings=14
- `npm run format:check`: passed
- `npm run lint`: passed
- `npm run typecheck`: 0 errors（既存 Astro `z` deprecation hints 22 件）
- `npm test`: 20 files / 283 tests passed
- `npm run build`: 65 pages built
- `npm run test:e2e`: 44 passed
- 最終確認で Batch 9 の予約登録を `reservePathForRules` に統一し、vertex だけでなく edge-swap / goal behavior も低レベル探索と同じ規則で検査するよう修正。再度 format / lint / typecheck / unit / build / e2e を通過。
- Batch 9 の展開数を Solver 全体で集計し、`timeout` / `node-limit` / `aborted` を構造化結果へ伝える制限処理を追加。

### 2026-08-03 Batch 9 レビュー修正

- LNS-wPBS に `extra.windowSize`（別名 `planningWindow`、既定 `w=10`。`mg-mapd-iros-2022` p.6 の実験設定）を接続した。`spaceTimeAStar.maxTime` はゴール到達まで残し、`reservationHorizon` と予約経路の切断だけを窓内に限定するため、`w` を探索上限として誤用していない。窓境界ごとに再計画し、窓内の stale な vertex / edge-swap 提案は次ステップで再計画する。
- `windowSize: 2` の `mapd-well-formed` で LNS-PBS は solved（average service time 11、makespan 20）だが LNS-wPBS は timeout（pending 1、conflicts 0）となるテストを追加。窓の shortsightedness による非完全性を固定した。単一 agent の multi-goal では goal が窓幅より遠くても solved になるテストも追加し、LNS-PBS の実装は変更していない。
- `rmca` と `regret-insertion` について `rmca-ral-2021` PDF の該当範囲を再確認し、完全性・最適性・準最適性の保証定理・補題を確認できなかった旨を `guarantee_evidence` に記録した。TTD は目的関数であり保証ではない。
- multi-goal の効果を単一 goal の対照と固定し、LNS-PBS / LNS-wPBS / RMCA の average service time が 6（単一 goal）から 8（2 goal）へ増えることを確認した。
- 品質ゲート再実行: `sources:validate` errors=0 warnings=14、format / lint / typecheck（0 errors）/ unit 20 files・288 tests。build 65 pages、E2E 44 tests もこの修正後に通過した。
