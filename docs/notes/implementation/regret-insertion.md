# Regret insertion 実装ノート

RMCA の内部割当部品として `src/lib/assignment/regret-insertion.ts` に置いた。
各 task の最良・次善 agent の marginal cost 差（regret）が大きい順に並べ、
caller が sequence へ挿入する。単体 MAPF / MAPD Solver ではなく、registry へは
登録しない。`rmca-ral-2021` はこの heuristic を使うが、古典的 VRP 原典までは
本リポジトリで確認していないため、その保証は unknown のままとする。

`rmca-ral-2021` PDF pp.3–4 の ordering と Algorithm 1–2 を確認したが、この
ヒューリスティクスに固有の完全性・最適性・準最適性の定理・補題は確認できなかった。
