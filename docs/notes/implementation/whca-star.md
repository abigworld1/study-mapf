# WHCA*（Windowed Hierarchical Cooperative A*）

- algorithm-id: `whca-star`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

Cooperative Pathfinding を実行と再計画に分ける windowed 手法。各 agent は次の `w` ステップだけ他 agent の予約を考え、抽象距離で window 以後を評価する。原論文は real-time game の継続実行を対象にする。サイトでは有限 one-shot MAPF を、全 agent が goal で安定するまで rolling horizon で解く。

## 原論文

- paper-id: `cooperative-pathfinding-2005`
- 参照した節: Windowed Hierarchical Cooperative A*、Discussion
- 参照したページ: PDF pp.3-4、6
- 参照した Algorithm 番号: 該当なし（RRA* は Algorithm 1 を再利用）

## 状態表現

現在の全 agent 位置、確定済み prefix、長さ `w` の部分経路、回転する priority order。低レベルは `(cell, local time)`、終端評価は `g + abstractDist(cell, goal)`。各 agent の RRA* OPEN/Closed を window 間で保持する。

## 遷移

各再計画時点で priority order に従って window 内の部分経路を予約し、`w` ステップ後の terminal edge に抽象距離を加える。window の半分を実行してから再計画し、先頭 priority を回転させる。原論文 PDF p.3 は動的に順序を変えて各 agent を短期間最高優先度にする方針を述べる。

## 目的関数

各 window 内で、通常移動コストと window 終端の抽象距離の和を最小化する。goal 上の wait は原論文 PDF p.4 の cost 式では 0。これは全体 sum of costs / makespan の最適化ではない。

## ヒューリスティック

HCA* と同じ RRA* 抽象距離。協調探索は `w` ステップだけ予約表を見る。

## 終了条件

全 agent が goal に到達し、サイトの `goalBehavior: stay` を満たす状態で成功。`options.extra.windowSize`（既定 16）と `replanInterval`（既定 `floor(w/2)`）を使う。全体 horizon、展開上限、タイムアウト、中断でも終了する。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                                                                |
| ---------- | ---- | --------------------------------------------------------------------------------------------------- |
| 完全性     | 不明 | Silver PDF p.6 は小さい window で success rate が下がると実験的に報告するが、不完全性の定理ではない |
| 最適性     | 不明 | PDF p.4 の「optimal sequence」は固定 window 内の部分列であり、MAPF 全体の最適性定理はない           |
| 準最適保証 | なし | window size による理論的なコスト係数は提示されていない                                              |

### 保証が成立する条件

一般 MAPF の完全性・最適性保証は確認できない。Silver PDF p.6 は window size を最長 bottleneck duration に合わせる実務指針を示すが、定理ではない。

## タイブレーク

初期順は `scenario.agents`。再計画ごとに先頭を末尾へ回して最高優先度を交代する。window 内 A* は `f`、`g`、生成順。原論文は「dynamically vary」と stagger の考えを示すが、厳密な rotation schedule は指定しない。

## 論文中で未指定の箇所

- 動的 priority の厳密な更新規則
- 全 agent の window を同期して再計画する場合の予約更新順
- 有限 one-shot Solver としての失敗判定
- サイトの stay-at-goal と、原論文の goal 到達後も window を続けて一時的に退ける挙動の両立

## 公開実装との差異

|                          | 方式                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | window `w`、midpoint 再計画、動的順序、terminal abstract edge、RRA* 再利用                                                |
| 公開実装で採用された方式 | `pibt2` は manifest / README で HCA* を含むが、確認した source tree に WHCA* 実装は無い。サブモジュール未取得でビルド不可 |
| 今回のブラウザ実装       | 同期 rolling window、半 window ごとの再計画、単純 rotation、goal 到達後 stay                                              |
| 差異を選んだ理由         | 再現可能で決定的な schedule とサイト既定の goal occupancy を守るため                                                      |

## 今回の実装方針

HCA* の RRA* を再利用し、windowed space-time A* を別関数として実装する。実行済み prefix は変更せず、未来だけを再計画する。各 window で衝突なしの部分経路を作り、実行区間の `move` / `replan` / `reserve` イベントを出す。

## 必要なテスト

- `windowSize` 以内だけ予約を考え terminal heuristic で goal 方向へ進む
- 複数 window を経て全 agent が衝突なく goal へ到達
- priority order が rotation する
- windowSize / replanInterval の option validation
- stay-at-goal、edge-swap、following
- 展開上限、horizon、timeout、abort、determinism、trace

## 未対応機能

- 原論文の frame 単位で RRA* 計算をさらに分割する scheduler
- 非同期 agent ごとの window midpoint
- goal 到達後に一時的に goal を離れて他 agent を通す挙動（サイト既定 stay のため）
- 一般 MAPF の完全性・最適性
