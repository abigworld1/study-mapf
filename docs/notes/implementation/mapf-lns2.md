# MAPF-LNS2（MAPF-LNS2）

- algorithm-id: `mapf-lns2`
- 調査日: 2026-08-01
- 担当: Codex

## 対象問題

one-shot MAPF。原論文は collision を含む plan も入力として許し、最終的に collision-free plan と小さい travel-time sum を求める。サイト版は 4 近傍 grid、vertex / edge-swap を禁止、following 許可、stay-at-goal に限定する。

## 原論文

- paper-id: `mapf-lns2-aaai-2022`
- 参照した節: §2 Definition 1、§3、§4.1–4.2、§5
- 参照したページ: pp.1–5
- 参照した Algorithm 番号: Algorithm 1（SIPPS）、Algorithm 2（expand）、Algorithm 3（insert）

## 状態表現

暫定 plan `P`、collision pair graph、近傍 `A_s`。hard reservation は避け、soft reservation との衝突数を評価する。ブラウザ版の低レベル repair は bounded soft-conflict search として実装する。

## 遷移

PP で初期 path を生成し、失敗した agent には衝突を許す path を割り当てる。各反復で collision-based / failure-based / random の近傍を選び、近傍を外して優先順に再計画する。collision pair 数が増えない場合だけ置換する。

## 目的関数

論文の primary repair criterion は colliding pairs（CP）、tie-break は travel-time sum。サイト版も受理判定を CP → SOC の辞書式で行う。最終 `metrics.sumOfCosts` はサイト共通の到着時刻和。

## ヒューリスティック

collision graph の connected component、失敗 agent の start を訪れる agent／goal を通る agent、degree+1 に比例する random selection。ALNS は CP 改善を neighborhood weight に反映する。

## 終了条件

CP=0 で `solved`。初期暫定 plan を作れない場合は `no-solution`。timeout、node-limit、abort では暫定 path（衝突が残る場合あり）と `failureReason: limit-exceeded` を返す。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                    |
| ---------- | ---- | ------------------------------------------------------- |
| 完全性     | なし | 原論文 p.1 abstract “it lacks theoretical guarantees”。 |
| 最適性     | なし | 同 p.1。                                                |
| 準最適保証 | なし | 同 p.1。                                                |

### 保証が成立する条件

理論保証はない。CP が減る経験的修復であり、有限打切り時の成功・品質を保証しない。

## タイブレーク

論文の priority ordering の同値順は未指定。サイト版は `context.random()` 由来の agent rank、agent index、cell index を使用する。候補 path は CP、SOC、到達時刻の順で比較する。

## 論文中で未指定の箇所

SIPPS の safe-interval 生成・soft obstacle の細部、初期 PP の優先順、ALNS の反応係数はサイトの上限と共通低レベル API に合わせる。

## 公開実装との差異

|                          | 方式                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | SIPPS で PMDO を解き、PP と 3 種 neighborhood + ALNS で CP を修復。                                           |
| 公開実装で採用された方式 | `Jiaoyang-Li/MAPF-LNS2` は USC Research License。SIPPS、ECBS/PBS/CBS、ランダム priority、実験用再起動を含む。 |
| 今回のブラウザ実装       | hard reservation 付き Space-Time A* と soft conflict 評価による教材用 repair。                                |
| 差異を選んだ理由         | SIPPS の全 PMDO 実装を既存 API に安全に組み込む範囲を限定し、第三者コードを転記しないため。                   |

### 参照実装のビルドと固定ケース

参照リポジトリは CMake で `/tmp` にビルドできた（Boost / Eigen を検出）。同じ Moving AI map/scen の先頭 2 agent、seed 7、1 秒制限では公式版が成功し SOC 64 を返した。ブラウザ版も同じ入力を deterministic context で実行し、`solved`、SOC 64、makespan 36、2 path となった。公式版の path 出力とブラウザ版は衝突なし・開始／ゴール・隣接移動をそれぞれ検査し、同一 seed のブラウザ結果も比較した。タイブレークと SIPPS の差により経路列は一致しない。

## 今回の実装方針

初期 PP の失敗 path を残し、近傍内の各 agent を soft collision 数最小の候補へ再計画する。CP 非増加かつ SOC 改善の候補を受理し、CP=0 を解とする。イベントで collision graph と修復の進行を可視化する。

## 必要なテスト

- 初期 collision plan が小規模 fixture で CP=0 へ修復されること
- 解が残る打切りで path validity と conflicts を返すこと
- CP が増える候補を reject すること
- seed 決定性、limits、abort、イベント

## 未対応機能

論文の SIPPS safe interval dominance、target obstacle の無限区間、全ての failure-based 連鎖、C++ 版の ALNS 更新は簡略化している。
