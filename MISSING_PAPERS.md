# 未完了資料レポート

`docs/sources/papers.yaml` と `docs/papers/` の実ファイルを突合した結果。自動生成。

生成日: 2026-07-26

---

## 資料の充足状況

| 項目 | 状況 |
|---|---|
| PDF 未取得 | **0** / 52 |
| Marker Markdown 未配置 | **0** / 52 |
| marker_meta.json 未配置 | **52** / 52 |
| PDF 照合未了 (`verified` でない) | **52** / 52 |

**PDF と Marker Markdown は全 52 本が揃っている。**
残る作業は PDF 照合のみ。手順は [SOURCE_ACQUISITION.md](SOURCE_ACQUISITION.md)。

`marker_meta.json` は 52 本すべてで存在しない。Marker が出力していないためで、
取得しようがない。バリデータは error ではなく warning に留めている。

---

## ★ 変換結果に注意が要る 4 本

### `astar-1968` — A*

marker.md の 1-62 行目は本論文ではなく、同誌の前の論文（非線形計画法）の参考文献リストである。IEEE Trans. SSC vol.4 no.2 の p.100 が前論文の末尾と重なっているため。本論文の本文は 63 行目「# A Formal Basis for the Heuristic Determination of Minimum Cost Paths」から 418 行目まで。PDF とのページ対応を保つため混入部分はあえて削っていない。全文検索するときは 63 行目以降に限定すること。

### `cbs-aij-2015` — CBS (journal)

marker.md の先頭は Elsevier の誌面ヘッダ（Artificial Intelligence / Contents lists available at ScienceDirect）で、論文タイトルはその直後にある。混入ではなく掲載誌のレイアウトどおり。

### `pbs-aaai-2019` — PBS

★ 機械照合で欠落を検出: PDF の Figure 5・6・7・8（いずれも実験結果の図）が marker.md に存在せず、語数も PDF 比 78% に留まる（他論文は 100-105%）。Experiments 節の本文が大きく脱落している。アルゴリズム定義（Priority-Based Search 節）と Theoretical Results 節は残っているため手法の解説には使えるが、性能に関する記述を書くときは必ず paper.pdf を参照すること。Marker で再変換すれば改善する可能性がある。

### `hungarian-method-1955` — Hungarian Method

★ 機械照合で欠落を検出: PDF には THEOREM 2（There is an assignment which is complete after ...）と THEOREM 4（There is an adequate budget and an assignment ...）があるが、marker.md には存在しない。1955 年の誌面スキャンを OCR したため脱落したと見られる。この 2 定理を引用する場合は必ず paper.pdf を直接読むこと。他の THEOREM 1/3/5/6/7 と LEMMA 1/2/3 は marker.md にある（大文字表記）。

### `gale-shapley-1962` — Gale-Shapley

marker.md の 1-28 行目は JSTOR の前付け（Accessibility support 等の閲覧条件）、145-150 行目は次の論文「GRADUATED INTEREST RATES IN SMALL LOANS」(Hugh E. Stelson) である。本論文の本文は 29-144 行目。PDF とのページ対応を保つため混入部分はあえて削っていない。全文検索するときは 29-144 行目に限定すること。

### `auction-algorithm-1988` — Auction Algorithm

誌面スキャンの OCR のため記号と見出しに崩れがある（実例: 「1. INTRODUf;rION」「rnin-cost」「nonline;ar」「(-relaxation」）。本文の意味は追えるが、数式・アルゴリズム番号・epsilon 記号を引用する際は必ず paper.pdf と照合すること。

---

## 再配布可否が未判定の 3 本

いずれも著者個人ページに置かれた出版社論文の著者版で、PDF 本文にも配布元にも
再配布許諾の記載が無い。外部リンクのみに留める（SOURCE_POLICY.md 第 12 条）。

| paper-id | 配布元 | 出版社 |
|---|---|---|
| `mstar-aij-2015` | http://biorobotics.ri.cmu.edu/papers/paperUploads/subdim_journal.pdf | Artificial Intelligence, vol. 219, pp. 1-24 |
| `sipp-icra-2011` | https://www.cs.cmu.edu/~maxim/files/sipp_icra11.pdf | IEEE International Conference on Robotics and Automation (ICRA 2011) |
| `auction-algorithm-1988` | https://www.mit.edu/~dimitrib/TheAuctionAP.pdf | Annals of Operations Research, vol. 14, pp. 105-123 |

---

## 理論保証が未確定

`algorithms.yaml` の **60 / 77 件**に `unknown` が残っている。
PDF が揃ったので、照合作業と並行して原論文の定理番号つきで確定させること（第 7 条）。

---

## 未登録の資料

`docs/output` / `docs/output2` には `papers.yaml` 未登録の論文が約 40 本ある
（MAPD 拡張、RMFS / オーダーピッキングの OR 文献、割当 / VRP 理論など）。
登録するには書誌情報の調査と、OR 系を受け入れる分類の新設が要る。
