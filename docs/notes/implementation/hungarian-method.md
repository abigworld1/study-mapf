# ハンガリアン法（Hungarian Method）

- algorithm-id: `hungarian-method`
- 調査日: 2026-08-01
- 担当: Codex

## 対象問題

線形割当問題。MAPF Solver ではなく、CBS-TA の target assignment 部品。

## 原論文

- paper-id: `hungarian-method-1955`
- 参照した節: §2 Simple Assignment、§3 General Assignment、Routine I
- 参照したページ: PDF pp.84–90
- 参照した Algorithm 番号: Routine I（p.90 以降）

## 状態表現

行=person/agent、列=job/target のコスト行列。`Infinity` は禁止割当。

## 遷移

dual label と alternating path を更新し、zero reduced-cost の割当を増やす。

## 目的関数

総コスト（本実装は最小化版。原論文の rating 最大化は符号反転で対応）。

## ヒューリスティック

なし。dual feasibility と zero reduced-cost 辺を使う。

## 終了条件

全行が異なる列へ割り当たったとき。禁止辺だけの場合は null を返す。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                                       |
| ---------- | ---- | -------------------------------------------------------------------------- |
| 完全性     | あり | p.89 Theorem 7 と p.90 の結論。有限回の Simple Assignment の列で解を得る。 |
| 最適性     | 最適 | p.89 Theorem 7「largest possible rating sum ...」および Routine I。        |
| 準最適保証 | なし | —                                                                          |

### 保証が成立する条件

有限の矩形行列と実行可能な完全割当。矩形の場合、余剰行／列は未割当を許すサイト API として扱う。

## タイブレーク

原論文は同値解を指定しない。行・列番号の昇順で deterministic に選ぶ。

## 論文中で未指定の箇所

禁止辺の表現と矩形行列 API。

## 公開実装との差異

|                          | 方式                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | 正方の rating 行列を Simple Assignment へ還元する。                                                                   |
| 公開実装で採用された方式 | libMultiRobotPlanning の `assignment` をビルドし、固定 4×4 行列で cost 275、`a0→t3, a1→t2, a2→t1, a3→t0` が一致した。 |
| 今回のブラウザ実装       | 矩形行列対応の primal-dual Hungarian 法。                                                                             |
| 差異を選んだ理由         | CBS-TA の N≠M と forbidden pair をモデル上で表すため。                                                                |

## 今回の実装方針

`src/lib/assignment/hungarian.ts` の純関数。CBS-TA の候補順序付けに使う。単体 Solver/registry には登録しないため ImplementationStatus は `library`。

## 必要なテスト

正方・矩形・禁止辺・同値解・不可能行列・参照実装の固定コスト。

## 未対応機能

整数以外の特殊コスト形式、割当履歴の可視化、単体シミュレータ実行。
