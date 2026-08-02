# CENTRAL（Centralized MAPD strawman）

- algorithm-id: `central`
- 調査日: 2026-08-02
- 担当: Codex

## 対象問題

lifelong MAPD。毎 step に free agent の task / parking endpoint を中央で選び、経路を再計画する。

## 原論文

- paper-id: `mapd-tp-tpts-central-2017`
- 参照した節: §5、§6
- 参照したページ: PDF p.5–8
- 参照した Algorithm 番号: Agent Assignment、Path Planning、Properties 5–7

## 状態表現

中央の token（全 agent の経路）と open task、free agent、non-task endpoint。論文は Hungarian assignment と CBS を使う。

## 遷移

free agent と task の assignment を Hungarian で選び、MLA* で token に衝突しない経路を計画する。task が無ければ non-task endpoint を割り当てて退避する。

## 目的関数

論文は MAPD の service time / makespan を比較するが、CENTRAL に最適性は要求していない。サイトでは共通ループの service time / throughput を計測する。

## ヒューリスティック

agent–pickup の壁考慮距離を Hungarian cost とする。parking は task endpoint を塞がない non-task endpoint を優先する。

## 終了条件

全 task delivery、または horizon / timeout。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                                                                       |
| ---------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| 完全性     | なし | PDF p.5 §5「do not require that it is optimally effective or even solves all well-formed MAPD instances.」 |
| 最適性     | なし | 同節で最適性を要求しない。                                                                                 |
| 準最適保証 | なし | 原論文に有界準最適性の主張はない。                                                                         |

### 保証が成立する条件

保証はない。well-formed 入力でも解決を保証しない。service time が TP / TPTS より小さい実験傾向は保証ではない。

## タイブレーク

Hungarian の結果、agent id、task id、endpoint row-major 順。論文の implementation-specific tie-break は未指定。

## 論文中で未指定の箇所

CBS の tie-break、central assignment の同点、再計画周期の詳細は未指定。

## 公開実装との差異

|                          | 方式                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------- |
| 論文で定義された方式     | endpoint assignment + Hungarian、占有 agent / free agent の二段 CBS path planning。 |
| 公開実装で採用された方式 | 第三者コードを転記せず、独立に再構成。                                              |
| 今回のブラウザ実装       | Hungarian + MLA* と既存 MAPD loop の逐次 token 計画。CBS は再実装していない。       |
| 差異を選んだ理由         | ブラウザの計算上限と既存 MapdStrategy API に合わせるため。                          |

## 今回の実装方針

central strategy は数値比較用の strawman として `status: runnable` / `fidelity: educational`。UI と解説で「小さい service time は保証を意味しない」と明示する。

## 必要なテスト

- well-formed preset 完了
- 非 well-formed でも loop 警告を二重化しない
- service time / throughput を返す
- deterministic assignment と token collision-free

## 未対応機能

論文の CBS 二段計画、無制限中央探索、実験 warehouse のスケール。
