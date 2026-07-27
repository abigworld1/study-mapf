# CONTENT_GUIDE.md — 解説ページの書き方

`src/content/algorithms/*.mdx` を書くときの規約。
実装の追加は [ALGORITHM_IMPLEMENTATION_GUIDE.md](ALGORITHM_IMPLEMENTATION_GUIDE.md)。

---

## 最優先の 3 つ

1. **資料が足りないページを創作で埋めない。** `<PreparingNotice />` を出す
2. **原論文で確認できていない理論保証を書かない。** 「不明」のままにする
3. **確認できていないページ番号を書かない。** 省略する

このサイトの価値は「書いてあることが原論文で裏が取れている」ことにある。
埋まっていないことは、埋まっているように見せるより価値がある。

---

## frontmatter

```yaml
---
title: "CBS"
algorithmId: cbs # algorithms.yaml の algorithm-id と一致させる
originalName: "Conflict-Based Search"
order: 100 # 一覧の並び順。学習順に沿わせる
summary: "衝突を制約に変換し、二層で探索する最適解法。"
status: draft # draft | reviewed | verified
primarySources:
  - paperId: cbs-aij-2015
    sections: ["5.1"] # 確認できたものだけ
    pages: [12] # 確認できたものだけ
implementationReferences:
  - repositoryId: libmultirobotplanning
lastReviewed: "2026-07-27"
simulatorSolverId: cbs # registry に実装がある場合だけ
---
```

`primarySources` を省略すると `algorithms.yaml` の `primary_paper_ids` にフォールバックする。
節・ページを特定できたら frontmatter に書く。書けば「確認済みの箇所」として表示される。

### status の意味

| 値         | 条件                                   |
| ---------- | -------------------------------------- |
| `draft`    | 原論文から作成中。骨格だけの場合もここ |
| `reviewed` | 原論文と Marker Markdown を照合済み    |
| `verified` | 原論文・実装・テストの 3 点を照合済み  |

**Claude Code が骨格だけ作ったページは `draft`。**
`verified` にしてよいのは、実装とテストまで突き合わせた場合だけ。

---

## ページの構成

`AlgorithmLayout` が「保証」「原論文」「公開実装」を自動で付ける。
本文には次の順で書く。書けない節は飛ばしてよい（無理に埋めない）。

```
概要
直感的な説明
対象問題
前提条件
入力と出力
アルゴリズムの流れ
小さな実行例
疑似コード
主要データ構造
計算量について分かっていること
長所
短所・失敗しやすい状況
関連手法との違い
実装上の注意
シミュレータ
```

「完全性・最適性などの保証」「原論文」「公開実装」はレイアウトが出すので本文に書かない。

---

## 出典の書き方

```mdx
import SourceCitation from "@/components/sources/SourceCitation.astro";

CBS は最適解を返します<SourceCitation paperId="cbs-aij-2015" label="Theorem 1" page={12} />。
```

→ `[cbs-aij-2015, Theorem 1, p.12]`

**書いてよいのは確認できた項目だけ。**

| 項目      | 確認方法                                          |
| --------- | ------------------------------------------------- |
| `section` | PDF の節番号を目で見る                            |
| `label`   | PDF の Algorithm / Theorem / Lemma 番号を目で見る |
| `page`    | PDF のページ番号を目で見る                        |

`docs/papers/<id>/metadata.yaml` の `machine_index` に、
PDF から機械抽出した番号付き要素とページ番号がある。**当たりを付けるのには使えるが、
そのまま出典にしない。** 目で確認してから書く。

Marker Markdown の見出し位置からページ番号を推測してはならない。

---

## 使えるコンポーネント

```mdx
import SourceCitation from "@/components/sources/SourceCitation.astro";
import PaperLink from "@/components/sources/PaperLink.astro";
import TerminologyNote from "@/components/sources/TerminologyNote.astro";
import Caution from "@/components/sources/Caution.astro";
import SimulatorLink from "@/components/SimulatorLink.astro";
import PreparingNotice from "@/components/PreparingNotice.astro";
```

| コンポーネント            | 用途                                                 |
| ------------------------- | ---------------------------------------------------- |
| `SourceCitation`          | 本文中の出典 `[paper-id, §x, Algorithm 1, p.y]`      |
| `PaperLink`               | 論文へのリンク（書誌情報つき）                       |
| `SourceList`              | 原論文の一覧（レイアウトが自動で出す）               |
| `GuaranteeTable`          | 理論保証の表（レイアウトが自動で出す）               |
| `AlgorithmStatus`         | 実装状態バッジ（レイアウトが自動で出す）             |
| `ImplementationReference` | 公開実装（レイアウトが自動で出す）                   |
| `TerminologyNote`         | 用語と原語の対応、紛らわしい語の区別                 |
| `Caution`                 | 誤解しやすい点、保証の限界、実装の落とし穴           |
| `SimulatorLink`           | シミュレータへの導線（実装がある場合だけ表示される） |
| `PreparingNotice`         | 解説準備中                                           |

### 用語の区別には `TerminologyNote` を使う

```mdx
<TerminologyNote term="最終的に最適" original="eventually optimal">
  時間を掛ければ最適解へ収束することを指します。 **有限時間で最適解を返すことは保証しません。**
  「最適」と混同しないでください。
</TerminologyNote>
```

### 保証の限界には `Caution` を使う

```mdx
<Caution title="PIBT は MAPF では完全でも最適でもありません">
  原論文が「PIBT is neither complete nor optimal for MAPF」と明記しています。
  完全なのは「ゴール滞在を要求しない変種」で、かつ Theorem 1 のグラフ条件下だけです。
</Caution>
```

---

## 資料が足りないとき

**書かない。** これを出す。

```mdx
import PreparingNotice from "@/components/PreparingNotice.astro";

<PreparingNotice
  algorithmId="cbs"
  needs={["原論文の該当節と Algorithm 番号の特定", "疑似コードと PDF の目視照合"]}
/>
```

表示されるのは次の 5 つだけ。

- ページタイトル（レイアウトが出す）
- 分類（パンくず）
- 実装状態（バッジ）
- 必要な資料（`needs`）
- 利用可能な原論文リンク（レイアウトが出す）
- 「解説準備中」

---

## 数式

KaTeX が使える。

```mdx
sum of costs は $\sum_{i} t_i$ で定義されます。

$$
\text{makespan} = \max_i t_i
$$
```

長い数式は横スクロールできる箱に入る（`.katex-display`）。ページ本体は横スクロールさせない。

---

## 疑似コード

**原論文の行をそのまま写さない。** 本サイトの記法へ書き直し、対応を注記する。

````mdx
```text
1  Root.constraints ← ∅
2  Root.solution ← 各エージェントの個別最短経路
3  OPEN ← {Root}
...
```

<SourceCitation paperId="cbs-aij-2015" label="Algorithm 1" page={7} /> に対応します。
````

長い原文引用は載せない（[SOURCE_POLICY.md](SOURCE_POLICY.md) 第 11 条）。
目安として 1 箇所あたり 1〜2 文を超える直接引用はしない。

図表も貼らない。必要なら自分で描き直し、「〜を参考に作図」と注記する。

---

## 文章のスタイル

- 主語を省かない。「〜される」より「CBS は〜する」
- 数値や条件は具体的に。「速い」ではなく「エージェント 100 体で 1 秒以内」
- 断定できないことは断定しない。「〜と考えられます」ではなく「原論文では確認できていません」
- 原語を併記する。「優先順位付き計画（Prioritized Planning）」

---

## 新しいページの作り方

```bash
# 1. algorithms.yaml に手法があることを確認
grep "id: my-algo" docs/sources/algorithms.yaml

# 2. MDX を作る
touch src/content/algorithms/my-algo.mdx

# 3. frontmatter を書き、本文は PreparingNotice から始める

# 4. 確認
npm run typecheck   # frontmatter のスキーマ検査も走る
npm run build
```

`algorithmId` が `algorithms.yaml` に無いと、保証の表が
「algorithms.yaml に <id> がありません」と赤字で出る。放置しない。

---

## チェックリスト

- [ ] `algorithmId` が `algorithms.yaml` の ID と一致している
- [ ] `status` が実態に合っている（骨格だけなら `draft`）
- [ ] 書いたページ番号・節番号は PDF を見て確認した
- [ ] 原論文にない理論保証を書いていない
- [ ] 「最適」と「eventually optimal」を区別した
- [ ] 長い原文引用をしていない。図表を貼っていない
- [ ] 資料不足の節は無理に埋めず飛ばした
- [ ] `npm run build` が通る
