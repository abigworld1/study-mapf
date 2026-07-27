# docs/ — 資料の置き場

MAPF / Lifelong MAPF / MAPD 教育サイトの、原資料とマニフェストを置くディレクトリ。
**サイト本体（HTML / CSS / JS / ビルド設定）はまだ存在しない。** 現段階は資料整備のみ。

公開予定 URL: <https://abigworld1.github.io/study-mapf/>

---

## 構成

```text
docs/
├── README.md            ← このファイル
├── papers/              原論文 PDF と Marker 変換 Markdown（論文 1 本 = 1 ディレクトリ）
│   └── <paper-id>/
│       ├── paper.pdf          .gitignore 済み。再配布可と確認できたものだけ git add -f
│       ├── marker.md          Marker の Markdown 出力
│       ├── marker_meta.json   Marker が出力した場合のみ
│       ├── metadata.yaml      取得記録・読解記録（雛形を配置済み）
│       └── images/            Marker が抽出した画像
├── sources/             機械可読なマニフェスト
│   ├── papers.yaml            論文 52 本
│   ├── repositories.yaml      参照実装 24 件
│   ├── algorithms.yaml        アルゴリズム 77 件
│   └── schema/                上記 3 つの JSON Schema
└── notes/               手法ごとの読解メモ（自由形式）
```

`docs/papers/<paper-id>/` は 52 本分すべて作成済みで、`metadata.yaml` の雛形が入っている。
`paper.pdf` と `marker.md` はまだ 1 本も無い。取得手順は
[SOURCE_ACQUISITION.md](../SOURCE_ACQUISITION.md) を参照。

---

## 3 つのマニフェストの関係

```text
                   algorithms.yaml
                 （手法 77 件・分類・理論保証）
                    ↑                ↑
   primary_paper_ids│                │implementation_repository_ids
                    │                │
              papers.yaml      repositories.yaml
             （論文 52 本）      （実装 24 件）
                    ↑                │
                    └────────────────┘
                          paper_ids
```

- **`papers.yaml`** — 「どこから資料を取るか」。URL・DOI・再配布可否・取得状態。
- **`repositories.yaml`** — 「どの実装を読んでよいか」。ライセンス・固定 commit・公式かどうか。
- **`algorithms.yaml`** — 「何を教えるか」。分類・原論文・参照実装・理論保証。

相互参照の整合性はバリデータが機械的に検査する。ID を追加・変更したら必ず実行すること。

```bash
node scripts/validate-sources.mjs
```

### 分類（`algorithms.yaml` の `category`）

| category                                | 内容                                                      |
| --------------------------------------- | --------------------------------------------------------- |
| `foundations`                           | 問題定義そのもの                                          |
| `single-agent-search`                   | BFS / Dijkstra / A*                                       |
| `space-time-search`                     | 時空間 A* / 予約テーブル / SIPP 系                        |
| `prioritized-planning`                  | PP / CA* / HCA* / WHCA* / PBS                             |
| `conflict-based-search`                 | CBS とその派生、SAT / SMT / ILP へのコンパイル            |
| `joint-state-and-subdimensional-search` | 結合探索 / OD / ID / M* / ICTS                            |
| `rule-based-and-configuration-search`   | Push and Swap / Push and Rotate / PIBT / LaCAM            |
| `large-neighborhood-search`             | MAPF-LNS 系                                               |
| `lifelong-mapf`                         | RHCR、Lifelong 問題定義                                   |
| `mapd`                                  | TP / TPTS / CENTRAL / TA-* / MLA* / RMCA / LNS-PBS        |
| `tapf-and-task-assignment`              | CBM / CBS-TA / ITA-CBS / ITA-ECBS                         |
| `matching-and-assignment`               | ハンガリアン法 / Gale-Shapley / オークション / 最小費用流 |
| `learning-based`                        | PRIMAL / PRIMAL2                                          |
| `benchmarks-and-tools`                  | MovingAI ベンチマーク、可視化ツール                       |

### 理論保証の読み方

`guarantees` の `unknown` は「保証が無い」ではなく **「原論文で未確認」** の意味である。
2026-07-26 に PDF 52 本が揃い、本文から定理・補題を抽出して 17 手法を確定させた。
**残り 60 件が `unknown` を含む。**

特に注意して読むべき確定結果:

- `pibt` — 原論文が「PIBT is **neither complete nor optimal** for MAPF」と明記している。
  完全なのは「ゴール滞在を要求しない変種」で、かつ Theorem 1 のグラフ条件下のみ
- `lacam-star` — 本文は「complete and optimal」だが、タイトルは「Eventually Optimal」。
  有限時間の最適性ではなく anytime な収束を指すため `conditional`
- `push-and-rotate` — 完全性の条件は「空き頂点が 2 つ以上（k ≤ |V| − 2）」

`true` / `conditional` には必ず `guarantee_evidence` が付いている。
根拠なしに保証を書くことは [SOURCE_POLICY.md](../SOURCE_POLICY.md) 第 7 条で禁止しており、
バリデータが error にする。

---

## 参照実装

`.references/<repository-id>/` に 24 件を clone 済み（`.gitignore` 済み）。

```bash
scripts/sync-reference-repos.sh          # 更新
node scripts/print-missing-sources.mjs --repos
```

**ライセンスは GitHub API の自動判定ではなく実ファイルで判定してある。**
USC 系 7 件は MIT ではなく独自の非営利ライセンス、`primal` / `primal2` は
著作権者表記に問題がある。詳細は [SOURCE_POLICY.md](../SOURCE_POLICY.md) 第 10 条。

コード転記が許されるのは `copy_allowed: true` の 10 件（MIT）のみ。それ以外の 14 件は読むだけ。

---

## notes/

手法ごとの読解メモを置く。形式は自由だが、次を守ること。

- ファイル名は `<algorithm-id>.md`（`algorithms.yaml` の ID と一致させる）
- 論文の記述を引くときはページ番号と節番号を書く（SOURCE_POLICY.md 第 6 条）
- 参照実装の挙動を書くときは repository-id と commit を書く

サイト本文の下書きではなく、**照合作業のログ**として使う。
