# Disjoint Splitting

- algorithm-id: `disjoint-splitting`
- 調査日: 2026-08-31
- 担当: Codex

## 対象問題

one-shot MAPF、sum of costs。サイト既定の 4 近傍、vertex / edge-swap conflict、stay at goal を扱う。`forbidFollowing` も正制約の時間方向の含意を含めて扱う。

## 原論文

- paper-id: `disjoint-splitting-icaps-2019`、保証の補助根拠 `cbsh2-rtc-aij-2021`
- 参照した節: §3、§4、§4.1、§4.2 / `cbsh2-rtc-aij-2021` Definition 2・Lemma 1・Theorem 2
- 参照したページ: PDF pp.2–3 / PDF p.6
- 参照した Algorithm 番号: 疑似コード番号なし

## 状態表現

CBS の CT node と制約集合を再利用する。`Constraint.positive` が true の制約は「指定時刻に指定頂点へ居る」または「指定時刻に指定辺を通る」という必須条件である。

## 遷移

衝突した 2 体から 1 体を選び、その同じ agent・同じ時空間条件について negative child と positive child を作る。negative child は条件を満たさない plan、positive child は条件を満たす plan を覆うため、2 枝は排他的かつ場合を尽くす。positive child では対象 agent に加え、正制約が暗黙に禁止する頂点・辺を使う他 agent も再計画する。

## 目的関数

sum of costs。CBS と同じ CT best-first key を使う。

## ヒューリスティック

低レベルは障害物を考慮した true distance。高レベル heuristic は追加しない。

## 終了条件

CBS と同じ。conflict-free CT node を返し、timeout、共有展開上限、有限 horizon、AbortSignal で打ち切る。

## 理論保証

| 項目       | 値       | 根拠（原文とページ）                                                                                                             |
| ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 完全性     | 条件付き | `disjoint-splitting-icaps-2019` PDF p.3 は全 candidate conflict-free plan が正負いずれかを満たすと説明。CBS 自身の条件を引き継ぐ |
| 最適性     | 最適     | `cbsh2-rtc-aij-2021` PDF p.6 Theorem 2 は mutually disjunctive な 2 constraint set による分割が CBS の完全性・最適性を保つと明記 |
| 準最適保証 | なし     | 最適 CBS の split 置換であり bounded-suboptimal 手法ではない                                                                     |

### 保証が成立する条件

正制約と暗黙の負制約を低レベルが厳密に守ること、正負の両 child を保持すること、低レベルが各制約集合で最短 path を返すこと。ブラウザ安全上限で打ち切られた実行は対象外。

## タイブレーク

論文 PDF p.3 §4.2 の Random 方策は、同じ優先度の conflict と、その 2 agent から一様乱択する。サイト版は既存 CBS コアの earliest-conflict 選択を維持し、split 対象 agent だけを `context.random()` で一様に選ぶ。同じ seed では決定的である。

## 論文中で未指定の箇所

原論文の中心定義は vertex conflict である。サイト版の edge-swap では、選んだ agent の実際の向きについて正負の edge constraint を作る。following conflict では、既存 CBS の vertex predicate の正負へ分割する。

## 公開実装との差異

|                          | 方式                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | positive landmark と negative constraint の 2 分岐。実験では Random ほか複数の agent 選択方策                           |
| 公開実装で採用された方式 | `cbsh2-rtc` は author-maintained だが USC 独自ライセンス。本バッチではコードを参照しない                                |
| 今回のブラウザ実装       | 既存 constrained A* に正制約を直接強制し、違反 path を持つ全 agent を再計画。vertex / edge / following をサイト型へ拡張 |
| 差異を選んだ理由         | 既存 CBS コアと決定的 seed を保ち、正制約の意味を 1 箇所で検査するため                                                  |

## 今回の実装方針

低レベルの頂点・遷移・goal suffix の制約判定を共通化する。正枝の再計画対象は現在 path を正制約と照合して決め、CT には正制約そのものを保存する。

## 必要なテスト

- 対象 agent が正 vertex / edge constraint を指定時刻に満たす
- 他 agent が正制約の頂点・辺を使えない
- 正負 2 branch の event と決定性
- certified SOC oracle との一致、共通 path 不変条件

## 未対応機能

論文 §4.1 の landmark 間だけを再探索する低レベル最適化、MDD Singletons / Width による agent 選択、Disjoint3。
