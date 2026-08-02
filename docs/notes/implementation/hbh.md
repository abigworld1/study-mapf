# HBH（Hungarian-Based / h-value-Based Heuristic）

- algorithm-id: `hbh`
- 調査日: 2026-08-02
- 担当: Codex

## 対象問題

MAPD の中央 task assignment heuristic。単独で経路を返す Solver ではなく、MLA* と組み合わせる `MapdStrategy` 部品。

## 原論文

- paper-id: `mla-star-icaps-2019`
- 参照した節: H-Value-Based Heuristic、Computational Experiments
- 参照したページ: PDF p.2–4（誌面 pp.182–184）
- 参照した Algorithm 番号: Algorithm 2

## 状態表現

available agent、released/open task、agent–task の h 値行列。割当後の path は共通 token に保存する。

## 遷移

論文 Algorithm 2 は h 値の昇順で agent–task pair を試し MLA* が成功した pair を採用する。サイト版は Batch 7 の Hungarian 法を再利用して assignment 候補を決め、各候補を MLA* で検証する。

## 目的関数

service time / makespan のヒューリスティック改善。最適性は主張しない。

## ヒューリスティック

pickup までの壁考慮距離。Hungarian cost にこの h 値を入れる。

## 終了条件

その step の free agent / open task を処理、または loop が全 task を完了。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                              |
| ---------- | ---- | ----------------------------------------------------------------- |
| 完全性     | 不明 | Algorithm 2 は heuristic。MLA* / HBH の完全性定理を確認できない。 |
| 最適性     | 不明 | 実験結果であり、最適性の定理ではない。                            |
| 準最適保証 | 不明 | 有界準最適性の根拠を確認できない。                                |

### 保証が成立する条件

不明。HBH は保証を持つ割当アルゴリズムとして論文に提示されていない。

## タイブレーク

論文の h 値昇順以外は未指定。サイト版は Hungarian の assignment、agent id、task id の順。

## 論文中で未指定の箇所

論文の本文は「h-value-based」と呼び、Algorithm 2 は pair の sort を示す。サイトの manifest 名「Hungarian-Based」は既存資料との互換名であり、Batch 7 の Hungarian を呼ぶ点はブラウザ実装の選択である。

## 公開実装との差異

|                          | 方式                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | Algorithm 2 の h-value pair sorting + MLA*。                                                 |
| 公開実装で採用された方式 | 本作業では第三者コードを転記していない。                                                     |
| 今回のブラウザ実装       | Hungarian assignment を順序付け部品として呼び、経路は MLA*。単体 Solver としては登録しない。 |
| 差異を選んだ理由         | 既存 Hungarian 実装を再利用し、HBH の assignment 部分を独立部品として明示するため。          |

## 今回の実装方針

`src/solvers/mapd/strategies.ts` の `createHbhStrategy` として提供し、registry には `hbh` を単独 Solver として追加しない。必要なら `central` との合成を通じて実行する。

## 必要なテスト

- Hungarian の cost 行列を呼ぶ
- MLA* が実行可能な pair を選ぶ
- 同じ seed で同じ assignment
- guarantee を `unknown` のまま扱う

## 未対応機能

論文の大規模 warehouse 実験、完全な中央再計画、単独の UI Solver。
