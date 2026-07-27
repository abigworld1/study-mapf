# SIPP（Safe Interval Path Planning）

- algorithm-id: `sipp`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

軌道が既知の動的障害物を避ける単一エージェント経路計画。原論文は一般の configuration と動作時間を扱う。今回のサイトでは 4 近傍グリッド、単位時間 move、wait 可能という離散モデルに限定し、MAPF で先に計画したエージェントの経路を動的障害物として与える。

## 原論文

- paper-id: `sipp-icra-2011`
- 参照した節: III. Algorithm（A. Planning with Safe Intervals、B. Theoretical Analysis）
- 参照したページ: PDF pp.2-5
- 参照した Algorithm 番号: 番号付き Algorithm はなく、Figure 4「A* with safe intervals」と Figure 5「getSuccessors」

## 状態表現

`(configuration, safe interval)`。到着時刻 `t` は状態同一性に含めない従属値で、同じ組には最早到着だけを保持する。サイトでは configuration を `cell`、safe interval を予約の無い閉区間 `[start, end]` とする。

## 遷移

隣接 configuration ごとに各 safe interval を調べ、現在区間内で必要最小限 wait した後に移動して、遷移先区間へ最も早く到着する `wait and move` を生成する。サイト既定の edge-swap を追加検査し、`forbidFollowing` が有効なら following も検査する。

## 目的関数

ゴールへの衝突なし経路の到着時刻（time-minimal cost）を最小化する。

## ヒューリスティック

原論文 PDF p.3 は consistent heuristic を仮定する。今回の実装は壁を考慮してゴールから逆向き BFS で得た true distance を使う。動的障害物を無視するため許容的である。

## 終了条件

ゴール configuration の状態を展開したとき成功する。`goalBehavior: stay` では、その safe interval が計画 horizon の末尾まで続く場合だけ受理する。原論文および `libmultirobotplanning` は最終区間が無限に続くことを要求するが、ブラウザ実装は明示的な有限 horizon で代用する。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                                                                    |
| ---------- | ---- | ------------------------------------------------------------------------------------------------------- |
| 完全性     | あり | PDF p.5 Theorem 1 の直後で、最早到着状態が全後継を包含するため completeness が保たれると説明            |
| 最適性     | 最適 | PDF p.5 Theorem 2「ゴール configuration の状態を展開したとき time-minimal, collision-free path を得る」 |
| 準最適保証 | なし | 基本 SIPP は最適探索。重み付き拡張は PDF p.8 で future work とされる                                    |

### 保証が成立する条件

PDF p.3 の仮定どおり、heuristic が consistent、遷移コストが実行時間、ロボットがその場で wait 可能、慣性制約を無視でき、動的障害物の将来軌道が既知であること。今回の離散実装では、指定 horizon 内に必要な全予約が含まれることも必要。

## タイブレーク

原論文は同一 `f` 値の順序を指定していない。今回の実装は `f` 昇順、到着時刻 `g` 昇順、cell の `y, x`、safe interval 開始時刻の順で決定する。

## 論文中で未指定の箇所

- MAPF の edge-swap / following 用語に合わせた離散衝突判定
- 有限 horizon で「最後の safe interval」を近似する方法
- 同一評価値のタイブレーク
- 複数エージェントへ適用するときの優先順位

## 公開実装との差異

|                          | 方式                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | configuration と safe interval を独立変数、到着時刻を従属値とする A*                                                                      |
| 公開実装で採用された方式 | `libmultirobotplanning` commit `4c75fa2` も同じ状態圧縮を行い、MAPF 例では SIPP を固定順に呼ぶ。example の edge-swap 検査には TODO が残る |
| 今回のブラウザ実装       | 原論文からの独立実装。有限離散 horizon、edge-swap / following、trace イベントを追加                                                       |
| 差異を選んだ理由         | サイト既定の衝突規則を満たし、ブラウザで必ず停止させるため                                                                                |

## 今回の実装方針

safe interval の構築と SIPP 探索を再利用可能な低レベル関数に分離する。Solver wrapper は原論文外の適用として、固定順に各エージェントを SIPP で計画する。その差異を metadata と解説に明記する。

## 必要なテスト

- 長い予約区間を timestep ごとでなく 1 safe interval 状態として越える
- 最早到着だけを保持しても最短解を返す
- goal の将来予約を避ける
- edge-swap / following 設定
- 時空間 A* と同じ小規模入力で同じ個別最短コスト
- interval 発見イベント、予約棄却イベント、決定性、中断、上限

## 未対応機能

- 連続時間、ロボット半径、複数の予測軌道、慣性・加速度制約
- 原論文の PR2 motion primitives
- 無限時間を記号的に保持する実装（有限 `maxHorizon` で打ち切る）
