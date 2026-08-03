# LNS-PBS 実装ノート

## 出典

- `mg-mapd-iros-2022` p.1 abstract（LNS-PBS / LNS-wPBS、MG-MAPD）
- 同 p.3 Algorithm 1（windowed variant）
- 同 p.5 Theorem 1（well-formed MG-MAPD 上の完全性）

## 実装

`src/solvers/mapd/batch9.ts` の task-sequence planner が release 済みタスクを
決定的に agent へ挿入し、各 agent の sequence の pickup と goal 列を順序付き
space-time A* で計画する。`assignSequence` と `carryingTasks` は MG-MAPD の
列・容量状態を表すための後方互換拡張である。

論文の LNS-PBS は LNS による anytime の destroy/repair、PBS の priority tree、
dummy path を用いた完全性を組み合わせる。本サイト版は教育用の骨格であり、
単一の決定的な挿入順と sequential A* に簡略化している。したがって manifest の
完全性は論文の条件付き主張であり、サイト実装の保証ではない。

## 目的と注意

サイトの `objective` は `average-service-time` と明示する。ただしこれは教育用 planner の
評価軸であり、サイト実装が論文の完全性を再現したという意味ではない。sum of costs は補助値である。
LNS-PBS の論文保証は well-formed MG-MAPD と finite task set に限る。
