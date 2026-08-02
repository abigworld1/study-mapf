# CBS-TA（CBS with Target Assignment）

- algorithm-id: `cbs-ta`
- 調査日: 2026-08-01
- 担当: Codex

## 対象問題

一般の target assignment and path finding。agent×target の binary matrix A を持ち、N と M の不一致や forbidden pair を表せる。TeamSpec はその block-diagonal 特殊形。

## 原論文

- paper-id: `cbs-ta-aamas-2018`
- 参照した節: §2、§3–4、Theorem 4.1/4.2
- 参照したページ: pp.2–4
- 参照した Algorithm 番号: K-best assignment と CBS-TA search forest

## 状態表現

`Scenario.assignment.allowed` の長方形行列と target ID。高レベル候補ごとに固定割当を one-shot MAPF へ変換する。

## 遷移

Hungarian の最良候補を先に評価し、候補割当ごとに既存 CBS を実行する。衝突は CBS が制約へ変換する。

## 目的関数

**sum of costs**。`SolverResult.objective` は `"sum-of-costs"`。CBM / tapf-baseline の makespan と比較しない。

## ヒューリスティック

start-target Manhattan cost の Hungarian 解を候補順序の deterministic tie-break に利用。

## 終了条件

候補列挙を完走した場合は SOC 最小の解。途中打ち切りの場合は最良既知解を返すが optimal は主張しない。

## 理論保証

| 項目       | 値                                      | 根拠（原文とページ）                                       |
| ---------- | --------------------------------------- | ---------------------------------------------------------- |
| 完全性     | あり（論文の assignment forest 条件下） | p.3 Theorem 4.1「CBS-TA is complete.」                     |
| 最適性     | 最適（SOC）                             | p.3 Theorem 4.2「minimizes the sum of individual costs」。 |
| 準最適保証 | なし                                    | ECBS-TA は別手法として言及される。                         |

### 保証が成立する条件

完全な assignment matrix、CBS low-level が完走し、有限の探索資源と十分な horizon があること。ブラウザ版の candidate limit / timeout 中は最良既知解に留まる。

## タイブレーク

原論文の K-best 同順位順は未指定。agent ID、target ID、CBS cost の辞書順で決定する。

候補の列挙順を決める Hungarian の順序付けは全候補を評価する場合の結果を変えない。論文の on-demand K-best 生成とは異なり、サイト版は先に全候補を列挙する。

## 論文中で未指定の箇所

論文 p.2 の条件 (2) は全 agent が許された potential goal で終わる定義なので、potential goal が空の agent やその退避先は定義していない。サイト版の「次数の小さい空きセルを優先する」退避規則は独自の拡張であり、`libmultirobotplanning` の内部規則を読んで一致させたものではない。参照実装が `potentialGoals: []` を受け付けることと、終端セルを検査することだけを確認している。

## 公開実装との差異

|                          | 方式                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | K-best assignment を遅延生成する search forest。                                                    |
| 公開実装で採用された方式 | libMultiRobotPlanning の `cbs_ta` と `assignment` / `next_best_assignment` テストを照合対象にする。 |
| 今回のブラウザ実装       | 全候補を決定的に列挙し、各候補を CBS で評価。                                                       |
| 差異を選んだ理由         | 小規模教育サイトで実装を独立保守し、候補数上限を明示するため。                                      |

## 今回の実装方針

`Scenario.assignment` を追加し、既存 TeamSpec からは block-diagonal 行列を導出する。余剰 target は未割当として表示し、割当の無い agent は target と start を避けた空きセルへ退避させる。退避先は次数の小さいセルを優先するサイト独自の決定規則で、論文や参照実装の規則を再現したものではない。退避の移動歩数と退避 agent の到達時刻（SOC 寄与）を計測し、実行時 warning に target 側 / 退避側の内訳を出す。CBS-TA は teams 形式と assignment 形式の両方を `canSolve` で受ける。

論文の abstract が挙げる key idea のうち、search forest と on-demand の K-best assignment 生成はサイト版では未実装である。候補数上限内で全候補を列挙し、各候補を CBS で評価する教育用実装なので、fidelity は `educational` とする。

## 必要なテスト

rectangular matrix、forbidden pair、TeamSpec 互換、N>M の parking warning と target / parking SOC 内訳、SOC オラクル、libMultiRobotPlanning の `mapfta_simple1_a*.yaml` 固定ケース、決定性。

## 未対応機能

論文どおりの遅延 K-best forest、ECBS-TA、巨大な N/M、GUI 上での割当行列編集。
