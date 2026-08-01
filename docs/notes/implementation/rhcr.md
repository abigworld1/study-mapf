# RHCR（Rolling-Horizon Collision Resolution）

- algorithm-id: `rhcr`
- 調査日: 2026-08-01
- 担当: Codex

## 対象問題

lifelong MAPF。原論文はオンラインで goal sequence が後から与えられ、throughput を最大化する。サイト版は `Scenario.kind: lifelong-mapf` の goal queue を使い、one-shot Scenario は一要素の固定 queue へ明示的に変換してブラウザで再現する。

## 原論文

- paper-id: `rhcr-aaai-2021`
- 参照した節: §3、§4、§4.1–4.4、§6
- 参照したページ: pp.3–8
- 参照した Algorithm 番号: Algorithm 1（goal sequence を扱う windowed low-level A*、p.4）

## 状態表現

現在時刻 `t`、各 agent の現在 cell、順序付き goal sequence、計画窓 `w`、再計画周期 `h`。各 episode は windowed MAPF を解き、先頭 `h` step を実行して状態を更新する。

## 遷移

`t` で start を現在位置へ更新し、各 goal までの path を計画する。path 全体を goal まで伸ばしつつ、予約表で collision を解消するのは最初の `w` step に限定する。`h` step をコミットし、到達した goal は sequence から削除する。

## 目的関数

原論文の windowed solver は flowtime、lifelong 全体は throughput（単位時間あたりの goal 到達数）を重視する。サイト版は完了 goal 数、throughput、平均 service time（goal 発生時刻から実際の到達時刻まで）、pending goals を計測し、one-shot の SOC と混同しない。

## ヒューリスティック

window `w`、再計画周期 `h`、goal queue の残数を使う。論文の distance 下界による goal 補充と progress-potential による動的 window 拡張は未実装である。

## 終了条件

`options.horizon` まで episode を繰り返す。goal sequence が全て空なら `solved`。未解決 window、timeout、node-limit、abort は構造化結果を返す。論文同様、一般の lifelong MAPF の完全性・最適性は主張しない。

`options.horizon` が未指定のときは `defaultMaxTime(scenario)`（マップ面積と goal 距離から決まる）を使う。**`w` から導いてはいけない。** `w` は衝突を解消する先読みの長さであって運転時間ではなく、以前 `w * 4` を既定にしていたときは既定 `w=8` で 32 step しか回らず、`warehouse` プリセットが RHCR と無関係な理由で `pending=1` になっていた。

`solved` 以外で終わった場合は必ず「解の非存在の証明ではない」旨の警告を出す。原論文の結論（p.8）が completeness を保証しないと明記しており、windowed 優先順位付き計画が詰まっただけの失敗を「解なし」と見せると過大主張になるため（SOURCE_POLICY.md 第 8 条）。実例として `swap-conflict` プリセットは CBS が sum of costs 11 で解くが、RHCR は `w` と horizon をどう変えても失敗する。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                                                                                  |
| ---------- | ---- | --------------------------------------------------------------------------------------------------------------------- |
| 完全性     | なし | 原論文 §4.4 p.6 は deadlock avoidance 付きでも incomplete と説明。結論 p.8 も complete / optimal を保証しないと明記。 |
| 最適性     | なし | 原論文 p.8 “does not guarantee completeness or optimality”。                                                          |
| 準最適保証 | 不明 | 固定倍率の保証は確認できず、throughput の実験評価のみ。                                                               |

### 保証が成立する条件

一般保証はない。`w >= h` が衝突回避の設計条件だが、これだけで完全性は成立しない。

## タイブレーク

論文は windowed PP の同値順を限定しない。サイト版は agent index、真距離、row-major cell、seed rank の順で決定する。

## 論文中で未指定の箇所

オンライン task assigner、dummy task、arrival 分布、low-level solver の同値順は外部システム依存。サイト版では既存の固定 goal を episode goal として使う。

## 公開実装との差異

|                          | 方式                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | ECBS / PBS / CA* / CBS の windowed variant を選び、オンライン task assigner と warehouse simulator を組み合わせる。       |
| 公開実装で採用された方式 | `Jiaoyang-Li/RHCR` は USC Research License。Poisson 新規 agent、warehouse entry/exit、複数の C++ windowed solver を含む。 |
| 今回のブラウザ実装       | 固定 Scenario の goal を順次再投入する簡略 lifelong episode と windowed prioritized planner。                             |
| 差異を選んだ理由         | task assigner や warehouse 固有状態を共通 Scenario API に捏造せず、`w` と `h` の核心を独立に可視化するため。              |

### 参照実装のビルドと固定ケース

参照リポジトリは CMake で `/tmp` にビルドできた（Boost を検出）。KIVA / SORTING の公式 warehouse map を `k=2` または `k=10`、`w=4, h=2` の短い実行で起動したが、いずれも初期 agent 配置後の timestep 0 で SIGSEGV となり、success/cost/makespan の比較は成立しなかった。公式実装の warehouse task assigner と共通 Scenario の固定 goal queue は入力・状態モデルが異なるため、ブラウザ版では同一 fixture の path validity、metrics、seed 決定性を unit test で検証した。

## 今回の実装方針

各 agent に goal queue を作り、`agents[].goal`（または実行時の `goalSequences`）を queue の先頭に置く。window 内の reservation を構築し、先頭 `h` step のみ path history に追加する。衝突検出と `replan` / `move` / `progress` を emit する。

## 必要なテスト

- `w >= h` の windowed 再計画と goal 到達
- throughput / pendingTasks / averageServiceTime の定義
- 短い window による未解決・limit の構造化結果
- 同じ seed の決定性、イベント、lifelong 以外の拒否

## 未対応機能

論文のオンライン Poisson task assigner、warehouse entry/exit、CBS/ECBS/PBS windowed variant の全実装、dynamic horizon の全て、dummy path と rotation 制約は未対応。
