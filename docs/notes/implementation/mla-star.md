# MLA*（Multi-Label A*）

- algorithm-id: `mla-star`
- 調査日: 2026-08-02
- 担当: Codex

## 対象問題

MAPD の 1 エージェント分の ordered goals（pickup → delivery）を計画する低レベル探索。サイトの `mapd` Solver ではなく、TP / TPTS / HBH の経路計画部品として使う。

## 原論文

- paper-id: `mla-star-icaps-2019`
- 参照した節: The Multi-Agent Pickup and Delivery Problem / Multi-Label A* Algorithm
- 参照したページ: PDF p.2–3（誌面 pp.182–183）
- 参照した Algorithm 番号: Algorithm 1（MLA*）、Algorithm 2（HBH）

## 状態表現

探索状態は `(position, time, label)`。label は pickup 前と pickup 後を表す。pickup セルに到達したら同じ時刻の pickup 後ラベルをキューへ入れ、delivery セルに pickup 後ラベルで到達したら終了する。

## 遷移

4 近傍への移動または wait。token に保存された他 agent の経路との vertex / edge-swap（必要なら following）衝突を捨てる。別 agent の delivery 終端が pickup にある場合は、その終端時刻を pickup 到達上限として扱う。

## 目的関数

経過 timestep（delivery 到達時刻）の最小化。

## ヒューリスティック

label に応じて `distance(position, pickup) + distance(pickup, delivery)` または `distance(position, delivery)`。距離は壁を考慮した BFS 距離。

## 終了条件

pickup 後ラベルで delivery に到達、またはキュー枯渇 / 時間・展開上限。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                      |
| ---------- | ---- | ----------------------------------------- |
| 完全性     | 不明 | MLA* 固有の定理・補題を確認できなかった。 |
| 最適性     | 不明 | A* 形式だけでは原論文の保証を推測しない。 |
| 準最適保証 | 不明 | 原論文で確認できなかった。                |

### 保証が成立する条件

不明。原論文は実験上の改善を報告するが、MLA* の完全性・最適性定理は確認できなかった。

## タイブレーク

論文は同じ f 値の規則を指定していない。サイト版は `f`、`h`、生成順（row-major の successor 順）の順で決める。

## 論文中で未指定の箇所

同点規則、実装上の priority queue、token の衝突判定のデータ構造は未指定。

## 公開実装との差異

|                          | 方式                                                                          |
| ------------------------ | ----------------------------------------------------------------------------- |
| 論文で定義された方式     | label 付き A* と tmax 制約。                                                  |
| 公開実装で採用された方式 | 本作業では第三者コードを転記せず、照合用にも使っていない。                    |
| 今回のブラウザ実装       | token の他 agent 経路を直接照合し、決定的 tie-break と browser の上限を追加。 |
| 差異を選んだ理由         | 依存を増やさず、既存 SolverContext / trace API に合わせるため。               |

## 今回の実装方針

`src/solvers/mapd/mla-star.ts` を純粋な低レベル planner とし、TP / TPTS / CENTRAL の共通コードから呼ぶ。MLA* 単体は MapdStrategy ではないため registry には登録しない。

## 必要なテスト

- pickup を経由しない経路を受理しない
- pickup 到達後に delivery へ進む
- token の vertex / edge-swap を避ける
- pickup tmax を超えるラベルを捨てる
- 同じ入力で同じ経路を返す

## 未対応機能

複数 task の ordered goals、動的な tmax の厳密な再計算、原論文の大規模実験環境。
