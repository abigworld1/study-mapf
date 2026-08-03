# LNS-wPBS 実装ノート

`mg-mapd-iros-2022` p.1 の「provides no completeness guarantee」、p.3 Algorithm 1、
p.5 の wPBS 定義を根拠にする。サイト版は LNS-PBS と共通の sequence planner に
rolling window を接続し、`extra.windowSize`（既定 10）ごとに再計画する。goal までの
探索は続けるが、他 agent の予約と goal occupancy の検査は窓内だけに限定する。
論文の全 priority search は再現しておらず、良い service time が完全性を意味しない
ことを UI 警告へ出す。`windowSize: 2` の well-formed プリセットでは、LNS-PBS が
解ける一方で LNS-wPBS は pending task を残して timeout することをテストで固定し、
窓の shortsightedness を確認している。

task sequence は `MapdStepOutput.assignSequence`、複数 goal は `TaskSpec.goals`、
経路の衝突回避は token 由来の予約表で実装した。論文の経験的な比較値を保証と
して扱わない。`SolverResult.objective` は `average-service-time` とするが、これは
表示上の評価指標であり、完全性・最適性を主張するものではない。
