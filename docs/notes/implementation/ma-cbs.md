# MA-CBS（Meta-Agent Conflict-Based Search）

- algorithm-id: `ma-cbs`
- 調査日: 2026-08-31
- 担当: Codex

## 対象問題

one-shot MAPF、sum of costs。サイト既定の 4 近傍、vertex / edge-swap conflict、stay at goal を扱う。

## 原論文

- paper-id: `ma-cbs-socs-2012`、`cbs-aij-2015`
- 参照した節: MA-CBS の merge policy / merging constraints、`cbs-aij-2015` §§8.2–8.6
- 参照したページ: `ma-cbs-socs-2012` PDF pp.2–6、`cbs-aij-2015` PDF pp.19–20
- 参照した Algorithm 番号: `ma-cbs-socs-2012` Algorithm 1、`cbs-aij-2015` Algorithm 2 の merge lines

## 状態表現

各 CT node は constraint、individual paths、SOC に加えて、agent ID を互いに素な meta-agent group へ分割した状態と、その root-to-node 経路で累積した conflict matrix を持つ。

## 遷移

conflict を観測するたび individual agent 対の回数を増やし、衝突した 2 meta-agent 間の累積回数が `B` を超えたら併合する。超えなければ CBS と同じ 2 分岐。併合 node は新しい meta-agent だけを joint low level で解き直して OPEN へ戻す。

## 目的関数

sum of costs。meta-agent low level も group 内 SOC の最適解を返す。

## ヒューリスティック

joint A* は各未確定 agent の障害物を考慮した goal 距離の和を許容 heuristic に使う。goal で path を終える選択を 0-cost commit として状態に持ち、goal を一度通って離れる path の SOC も過小評価せず表現する。

## 終了条件

meta-agent 間 conflict が無い CT node を返す。meta-agent が 3 体を超える併合、timeout、共有展開上限、有限 horizon、AbortSignal では打ち切る。

## 理論保証

| 項目       | 値       | 根拠（原文とページ）                                                                                                                          |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 完全性     | 条件付き | `cbs-aij-2015` PDF p.20 §8.5 は low level に completeness を要求し、§8.6 は CBS の completeness proof が MA-CBS にも成立すると述べる          |
| 最適性     | 最適     | PDF p.19 は meta-agent low level を optimal MAPF solver で解くこと、constraint merging が optimality を保つ必要を明記。p.20 §8.6 が証明を拡張 |
| 準最適保証 | なし     | 最適 framework であり bounded-suboptimal 版ではない                                                                                           |

### 保証が成立する条件

meta-agent low level が complete・constraint-respecting・optimal であること、外部 constraint を元の individual agent にだけ引き継ぎ、内部 constraint を除くこと。ブラウザの meta-agent size 3、有限 horizon、展開・時間上限に達した実行は保証対象外。

## タイブレーク

CT は CBS と同じ SOC、conflict 数、FIFO。joint A* は `f`、`h`、時刻、生成順。merge threshold の既定 `B=1` は論文の既定ではなく、教材盤面で merge を観察しやすくするサイト上の選択。

## 論文中で未指定の箇所

ブラウザで安全な最大 meta-agent size。サイト版は 3 とする。論文は `B=0,1,5,10,100,500,∞` を比較するが単一の既定値を指定しない。

## 公開実装との差異

|                          | 方式                                                                             |
| ------------------------ | -------------------------------------------------------------------------------- |
| 論文で定義された方式     | 任意の complete / optimal constrained MAPF solver を meta-agent low level に使う |
| 公開実装で採用された方式 | 本マニフェストに MA-CBS の公開実装は登録されていない                             |
| 今回のブラウザ実装       | 最大 3 体の独立 joint A*。`B` は `extra.mergeThreshold`、UI 空欄は `∞`           |
| 差異を選んだ理由         | ブラウザの停止可能性と教材上の可観測性を両立し、対応範囲外を正直に打ち切るため   |

## 今回の実装方針

制約には branch 時の subject group と opponent group を内部記録する。後の merge で両 group が同一になった record は内部 constraint として除き、外部 record は branch 時の subject agent だけへ残す。merge 後に生じた conflict の branch は meta-agent 全員へ同じ時空間禁止を課す。

## 必要なテスト

- `B=0` で 2-agent joint search と merge event
- `B=∞` で CBS と同じ SOC
- 外部 constraint の individual 継承、内部 constraint の除外
- 設定した meta-agent size 上限を超える merge の `node-limit` + 警告
- certified SOC oracle との一致、決定性、共通 path 不変条件

## 未対応機能

4 体以上の meta-agent、EPEA* / OD / M* low level、merge-and-restart、recursive MA-CBS、論文の大規模 benchmark 最適化。
