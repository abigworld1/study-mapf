# RMCA 実装ノート

## 出典

- `rmca-ral-2021` p.1–2（capacity 1 の既存 MAPD との差）
- 同 p.3 式 (1)（total travel delay, TTD）
- 同 p.4 Algorithm 1 / Algorithm 2（assignment heap と collision repair）

PDF pp.1–4 を確認したが、RMCA または regret ordering の完全性・最適性・
bounded-suboptimality を述べる定理・補題は見つからなかった。p.3 の TTD は
目的関数の定義であり、理論保証ではない。

## 実装

`AgentSpec.capacity` と `MapdStepInput.carryingTasks` で複数 task の同時 carrying を
表し、`TaskSpec.goals` で goal 列を表す。`regret-insertion.ts` は論文の regret-based
marginal-cost ordering を副作用のない内部部品として実装し、単独 Solver にはしない。
経路は予約表付き sequential A* で計画する教育用簡略版で、論文の potential-assignment
heap 全体と top-v collision repair は未再現である。

## 目的関数

RMCA が最小化するのは service time ではなく TTD。`SolverResult.objective` は
`total-travel-delay`、`metrics.totalTravelDelay` に `completion - (release + shortest
pickup-to-goal travel)` の総和を入れる。画面の average service time は別指標であり、
TP / TPTS / CENTRAL と数値の優劣を直接比較しない。
