# MAPD 実行ループと貪欲ベースライン

- algorithm-id: `mapd-greedy`（サイト独自。`algorithms.yaml` の手法ではない）
- 実行ループ: `src/solvers/mapd/loop.ts`
- 調査日: 2026-08-02
- 担当: Claude Code

## これは何か

MAPD（multi-agent pickup and delivery）をブラウザで扱えるようにするための土台。
2 つある。

1. **実行ループ** `runMapdLoop`。時刻を進めながら task release / 割当 /
   移動 / pickup / delivery / service time 計上を回す。割当も経路計画も
   一切決めず、`MapdStrategy` に委ねる。Batch 8 の TP / TPTS / CENTRAL は
   戦略だけを書けば載る。
2. **貪欲ベースライン** `mapd-greedy`。**論文手法ではない。**
   ループが動くことを確かめ、TP の対照として置いている。

## 対象問題

MAPD。定義は `mapd-tp-tpts-central-2017` p.2 §3.1–3.2 に従う。

- タスクは任意の時刻に系へ現れる。各タスクは pickup と delivery を持つ。
- 手の空いたエージェントが未実行タスクに割り当てられる。
- 割り当てられたら pickup へ行き、次に delivery へ行く。衝突は避ける。

**service time**（同 p.2 §3.1）:

> the average number of timesteps, called service time, needed to finish
> executing each task **after it was added to the task set**

起点は `releaseTime`。割当時刻でも pickup 時刻でもない。
同じ箇所が「A MAPD algorithm **solves** a MAPD instance iff the resulting
service time of all tasks is **bounded**」とも定めており、MAPD の「解けた」は
one-shot MAPF の意味とは別物である。

## endpoint と well-formed

同 p.2 §3.2:

- `V_ep` = エージェント初期位置 ∪ 全タスクの pickup/delivery ∪ 追加 parking
- `V_tsk` = 全タスクの pickup/delivery（task endpoints）
- `V_ep \ V_tsk` = non-task endpoints

狙いは「エージェントが永久に留まってよいのは、他を塞がない場所だけ」。

**Definition 1**（同 p.2）:

> A MAPD instance is well-formed iff
> a) the number of tasks is finite,
> b) there are no fewer non-task endpoints than the number of agents, and
> c) for any two endpoints, there exists a path between them that traverses
> no other endpoints.

`src/lib/model/mapd.ts` の `checkWellFormed` が 3 条件を検査する。
(c) は endpoint の対ごとに、両端以外の endpoint を壁扱いした BFS で見る。

★ **well-formed は十分条件であって必要条件ではない**（同 p.2「We now provide
a sufficient condition that makes MAPD instances solvable」）。
「満たさない = 解けない」と書かないこと。UI の文言もそう作ってある。

★ 対の数が上限（400）を超えたら (c) を省略し、`checked: false` を返す。
判定していないものを well-formed と呼ばないため、そのとき `wellFormed` は
常に `false` になる。

## 実行ループの 1 ステップ

順序を固定してある。変えると service time が 1 ずれるので、手法を
差し替えても比較できるようにここで決め切っている。

1. `releaseTime <= t` のタスクを task set へ入れる（`release-task`）
2. 戦略に尋ねる（割当と次の 1 歩）
3. 全エージェントを 1 歩進める（`move`）
4. pickup / delivery を判定して計上する（`pickup` / `delivery`）

pickup / delivery を移動の後に見るのは、時刻 t の位置が確定してからでないと
「その地点に居る」を判定できないため。

★ ループは戦略の返した 1 歩について、隣接か現在地かだけを検査する。
**衝突は直さない。** 衝突を避けるのは戦略の仕事で、避けられなかったことは
結果の `conflicts` に出す。ループが黙って直すと、不完全な手法が完全である
かのように見えてしまう。

## 貪欲ベースラインが TP と違うところ

|                | TP（論文、Batch 8 実装）                   | `mapd-greedy`（サイト独自）                     |
| -------------- | ------------------------------------------ | ----------------------------------------------- |
| 割当           | token を 1 体ずつ回して各自が選ぶ          | 中央で距離最小を貪欲に選ぶ                      |
| 手が空いたとき | non-task endpoint へ退避（同 p.3-4 Path2） | **その場に居座る**                              |
| pickup 経由    | —                                          | start→pickup と pickup→delivery の 2 回に分ける |
| 保証           | well-formed なら解ける（同 p.4 Theorem 3） | **無し**                                        |

★ 居座りが本質的な違い。TP の Property 2（同 p.4）は「手が空いたエージェントを
他を塞がない non-task endpoint へ退かせられる」ことを示し、それが
デッドロックを防いでいる。ベースラインはそれをやらないので、作業地点や通路の
上で止まって後続を塞ぐ。**詰まる様子そのものが Property 2 の存在理由の説明**
になる、というのがこのベースラインを置いた理由である。

★ pickup を経由する経路を 2 回の探索に分けているのも簡略化。
1 本の探索で扱うのが MLA*（`mla-star`、Batch 8）で、分けると pickup での
待ち時間を最適化できない。

## 実測

| プリセット             | 結果    | 完了 | 平均 service time | throughput |
| ---------------------- | ------- | ---- | ----------------- | ---------- |
| `mapd-well-formed`     | solved  | 3/3  | 9.0               | 0.214      |
| `mapd-not-well-formed` | timeout | 1/2  | 8.0               | 0.015      |

`mapd-not-well-formed` は条件 (b) を満たさない（退避地点 1 個に対し
エージェント 2 体）。実行すると保証の対象外である旨の警告が出る。

## 理論保証

`mapd-greedy` には**無い**。`algorithms.yaml` には登録しない。

## Batch 8 への引き継ぎ

- **TP / TPTS は `MapdStrategy` を実装するだけで載る。** Batch 8 で実装済みで、旧ループ分岐は変えていない。
  `MapdStepInput.endpoints` に `nonTask` が入っているので、Path2 相当は
  そこから選べる。
- **token を明示的に持つこと。** TP の token は「全エージェントの経路と
  タスク集合」で、Path1 / Path2 はそれを見て衝突を避ける（同 p.2-3）。
  いまのベースラインは予約表で代用しているが、TP は token をそのまま
  実装したほうが論文に忠実になるし、`update-token` イベントも既にある。
- **CENTRAL は保証を持たない**（同 p.1 abstract「a centralized strawman MAPD
  algorithm **without this guarantee**」）。TP / TPTS と並べるときに
  この差を消さないこと。
- **MLA\* を先に実装すると TP の低レベルがきれいになる。** pickup 経由を
  1 本の探索で扱える。
- `mapd-greedy` は保証が無いので、TP の正しさの照合には使えない。
  比較できるのは service time と throughput の傾向だけ。

## 必要なテスト

- endpoint の分割（V_ep / V_tsk / non-task）が論文の定義どおり
- Definition 1 の条件 (b) と (c) をそれぞれ落とせる
- 上限超過のとき well-formed と名乗らない
- service time が releaseTime 起点（release を遅らせても値が変わらない）
- `release-task` → `pickup` → `delivery` の順に emit される
- well-formed でない入力に保証対象外の警告が出て、well-formed には出ない
- タスク 0 件と MAPD 以外の Scenario を構造化して拒否する
- 同じ seed で同じ結果
- `Scenario.kind` による Solver 絞り込み

## Batch 9 で追加された拡張

`TaskSpec.goals`（multi-goal）、`AgentSpec.capacity`（capacity）と
`MapdStepInput.carryingTasks` / `MapdStepOutput.assignSequence` を後方互換で追加した。
旧 strategy は従来の `carrying` 投影を受け取り、capacity 1・単一 goal の結果は変わらない。
実行順序 release → strategy → move → pickup / delivery は維持している。

## 未対応

タスクの動的追加（実行中に releaseTime が未知のまま増える形）、
エージェントの充電・故障。
