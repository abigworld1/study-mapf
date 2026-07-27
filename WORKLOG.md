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
