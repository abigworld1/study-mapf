# CBSH（CBS with Heuristics）

- algorithm-id: `cbsh`
- 調査日: 2026-08-31
- 担当: Codex

## 対象問題

one-shot MAPF、sum of costs。サイト既定の 4 近傍、vertex / edge-swap conflict、stay at goal を扱う。

## 原論文

- paper-id: `cbsh-icaps-2018`
- 参照した節: Abstract、§3、§3.1、§3.2、§5
- 参照したページ: PDF pp.1–4
- 参照した Algorithm 番号: 疑似コード番号なし

## 状態表現

CBS / ICBS の CT node に、cardinal conflict graph と許容 `h` を加える。graph の頂点は cardinal conflict に関与する agent、辺は cardinal conflict の agent 対である。

## 遷移

ICBS と同じ cardinal / semi-cardinal / non-cardinal 優先順位付けと helpful bypass を使う。CT OPEN は `g+h`、次に conflict 数、`g`、生成順で選ぶ。

## 目的関数

sum of costs。`g` は現在 paths の SOC、`h` は将来必要な SOC 増分の下界。

## ヒューリスティック

cardinal conflict graph の minimum vertex cover size。graph の関与頂点が 18 以下なら exact branch-and-bound、超える場合はサイト独自の deterministic maximal matching size を弱い許容下界として使う。近似 vertex cover の大きさは使わない。

## 終了条件

conflict-free CT node を返す。その他の安全停止は CBS と共通。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                                                                                |
| ---------- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| 完全性     | 不明 | `cbsh-icaps-2018` PDF 全 5 ページを確認したが、CBSH 固有の完全性を明示する定理・補題は確認できなかった              |
| 最適性     | 不明 | PDF pp.1–3 は heuristic を admissible と述べるが、CBSH の最適性を明示する定理・補題は確認できなかったため推測しない |
| 準最適保証 | なし | bounded-suboptimal 手法としては提示されていない                                                                     |

### 保証が成立する条件

実装上は `h` を過大評価させず、`g+h` の best-first と最短 low level を保つ。これは実装テストの前提であり、マニフェストの未確認保証を埋める根拠にはしない。

## タイブレーク

論文の CBS tie-break に合わせ、`g+h`、conflict 数、`g`、FIFO の順。maximal matching は正規化した agent ID 順で辺を走査する。

## 論文中で未指定の箇所

教材規模と大規模入力の境界。サイト版は exact MVC の対象を conflict graph の関与頂点 18 以下とし、それより大きい graph では admissible な matching 下界へ下げる。

## 公開実装との差異

|                          | 方式                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | §3.1 の matching と §3.2 の minimum vertex cover                                                    |
| 公開実装で採用された方式 | `cbsh2` は author-maintained だが USC 独自ライセンス。本バッチではコードを参照しない                |
| 今回のブラウザ実装       | 小規模 exact MVC + 大規模 greedy matching fallback。既存の child-cost classification と BP を再利用 |
| 差異を選んだ理由         | NP-hard な exact MVC でブラウザを固めず、かつ常に許容下界を保つため                                 |

## 今回の実装方針

cardinal 判定は既存 ICBS と同じく 2 child の最短 cost を probe する。cardinal edge が無い node は明示的に `h=0` とする。PC が cardinal を先に選ぶため `h>0` の node から same-cost bypass は行わず、zero-cost edge で goal へつながり得る node は `h=0` になる。

## 必要なテスト

- exact MVC と greedy matching lower bound の固定 graph
- zero-cost helpful bypass node の `h=0`
- `g+h` の CT 選択 event
- certified SOC oracle との一致と共通 path 不変条件

## 未対応機能

論文 ICBS-h4 の親 `h` を使った増分 vertex-cover 判定、MDD cache、CBSH2 の DG / WDG。
