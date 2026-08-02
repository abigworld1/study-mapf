# Codex 用プロンプト — Batch 8 レビュー修正

> このファイルは Codex へそのまま貼るためのもの。`---` 以下を全部コピーして使う。

---

Batch 8 のレビューで 2 件の問題が見つかりました。どちらも Batch 8 のコードの話です。

**先に共有しておくこと：あなたの報告にあった「既存 `MapdStrategy` API の制約により
未対応」という指摘は正しく、こちらで API を直しました。** 以下の修正はその新しい API
を前提にしています。

なお、あなたが CENTRAL を §5 と書いたのは正しく、こちらのプロンプトが §6 と書いて
いたのが誤りでした。自分で PDF を確認してくれたおかげで正しく入っています。

# こちらで済ませたこと（触らなくてよい）

## 1. `MapdStepOutput` を拡張した（`src/solvers/mapd/loop.ts`）

```ts
export interface MapdStepOutput {
  /** 割り当て。他のエージェントが持つタスクも、pickup 前なら奪える。 */
  readonly assign?: ReadonlyMap<AgentId, TaskId>;
  /** 割り当てを解く。pickup 済みは解けない。 */
  readonly unassign?: readonly AgentId[];
  readonly moves: ReadonlyMap<AgentId, Cell>;
}
```

**奪い取りの条件はループ側で強制しています。** 戦略が pickup 済みのタスクを奪う
指定を書いても、ループが黙って無視します。論文 p.4 §4.2 の
「as long as that agent is still moving to the pickup location」を
1 箇所で守るためです。奪い取りが成立したときは、ループが自動で
`swap-task` イベントを出します。**戦略側で二重に出さないでください。**

奪われた側は手が空きます。ループは戦略の内部状態を知らないので、
**古い計画の破棄は戦略の責任です。** `swap-task` イベントか、次ステップの
`carrying` を見て捨ててください。

`unassign` は `assign` より先に処理されます。同じステップで
「a から外して b へ渡す」を書いても消えません。

検査は `tests/unit/mapd.test.ts` の
「割当の奪い取りと解除（ループ側の強制）」に 4 件入れてあります。
**このテストを壊さないでください。**

## 2. 判別できるプリセットを 2 つ足した（`src/lib/model/scenario.ts`）

- `mapd-task-swap` — 遠い agent が取ったタスクを、あとで空いた近い agent が
  奪えると得をする形。TPTS の swap を試すためのもの。well-formed。
- `mapd-parking` — 手が空いた agent が、あとから出るタスクの delivery 地点に
  立ってしまう形。TP の Path2 が働くかを見るためのもの。well-formed。

---

# 直してほしいこと

## 指摘 1（重大）TP と CENTRAL が「解が求まりました」なのに衝突を残します

`mapd-task-swap` プリセットで再現します。

```text
mapd-greedy    solved  完了 2/2  svc 13.00  mk 22
token-passing  solved  完了 2/2  svc 13.00  mk 22   ★衝突 1
tpts           solved  完了 2/2  svc 15.00  mk 17
central        solved  完了 2/2  svc 13.00  mk 22   ★衝突 1
```

衝突の中身：

```text
vertex conflict  a1 と a2  cell (10,0)  time 11

a1: … 10:(10,1) 11:(10,0) 12:(10,1) …      ← t1 の pickup へ入る
a2: … 4:(10,0) 5:(10,0) … 22:(10,0)        ← t2 を配達後ずっと居座る
```

a2 は t2 を (10,0) で配達したあと、そこに resting path を置いたまま動きません。
a1 は t1 の pickup が同じ (10,0) なので、そこへ入って重なります。

**これは TP の Path1 の契約違反です。** 論文 p.3 の Path1 は
「does not collide with the paths of other agents stored in the token」を
満たす経路を返すことになっています。a2 の resting path が token に入っていれば、
a1 は (10,0) へ入る経路を作れないはずです。つまり次のどちらかです。

- 手が空いた agent の resting path を token に入れていない
- 低レベル（MLA\*）が token の resting path を照合していない

**やること：**

- 原因を特定して直す。`solved` を返すときは衝突 0 であること。
- 経路を作れないときは `solved` と言わないこと。
- `mapd-task-swap` で TP / TPTS / CENTRAL とも衝突 0 になることをテストで固定する。
- ついでに、**全 MAPD プリセット × 全 MAPD 手法で衝突 0** を回すテストを 1 つ置くこと。
  今回はプリセットを増やして初めて出た問題なので、網羅する形にしてください。

★ ループは衝突を直しません（意図的です）。避けるのは戦略の仕事で、
避けられなかったことは `conflicts` に出る設計です。ループ側で握り潰さないでください。

## 指摘 2（中）TPTS の中心的な機能を仕上げてください

論文 p.4 §4.2 の TPTS の定義：

> its task set now contains **all unexecuted tasks**, rather than only all tasks
> that have no agents assigned. This means that an agent with the token can
> assign itself not only to a task that has no agent assigned but also to
> **a task that is already assigned another agent as long as that agent is
> still moving to the pickup location** of the task. … The latter agent is then
> no longer assigned to the task and no longer needs to execute it.
> The former agent therefore **sends the token to the latter agent** so that
> the latter agent can try to assign itself to a new task.

いまの実装は同一 timestep 内の未確定 assignment しか交換できません。
**新しい API（`assign` による奪い取り）で、前の timestep に割り当てられて
pickup へ向かっている途中のタスクも奪えるようにしてください。**

守ること：

- 奪うのは「より近い agent が奪ったほうが得なとき」だけ。
  論文は「This might be beneficial when the former agent can move to the pickup
  location of the task in fewer timesteps than the latter agent」と書いています。
  無条件に奪うと振動します。
- 奪われた側は手が空くので、そのステップで新しいタスクを取りにいけること
  （論文の「sends the token to the latter agent」に相当）。
- 奪われた側の古い計画を捨てること（ループはやりません）。
- `swap-task` はループが出します。戦略から二重に出さないこと。
- **TPTS が TP と違う結果を出すことをテストで固定してください。**
  `mapd-task-swap` を使ってよいですが、「TP と TPTS の経路が一致しない」だけでなく
  「奪い取りが起きた」ことを `swap-task` イベントで確認する形にしてください。

## 指摘 3（軽）`mapd-parking` で TP の Path2 が効いていません

新しく足した `mapd-parking` は、t1 を終えた agent が (5,0) に立ち、
あとから出る t2 の delivery が同じ (5,0) という形です。論文 p.4 の Path2 は

> moves from its current location to an endpoint such that **the delivery
> locations of all tasks in the task set are different from the chosen endpoint**
> and no path of other agents in the token ends in the chosen endpoint

なので、t2 が現れた時点で agent はそこを空けなければなりません。

ところが現状、4 手法（endpoint 規律を持たない `mapd-greedy` を含む）が
**まったく同じ結果**を返します。TP の Path2 が働いていれば `mapd-greedy` とは
違う経路になるはずです。指摘 1 と同じ「手が空いた agent の扱い」が原因の可能性が
高いので、まとめて調べてください。

直した結果このプリセットで差が出ないなら、**プリセットが弱いのか実装が
足りないのかを切り分けて報告してください。** プリセットを直してもかまいません。

---

# 完了条件

- 既存の品質ゲートが全部通る
  （`sources:validate errors=0` / format / lint / typecheck / unit / build / e2e）
- **全 MAPD プリセット × 全 MAPD 手法で衝突 0**（`solved` のとき）
- `mapd-task-swap` で TPTS が TP と異なる結果を出し、`swap-task` が発生する
- `tests/unit/mapd.test.ts` の「割当の奪い取りと解除」4 件が通ったまま
- `runMapdLoop` と `src/lib/model/mapd.ts` を書き換えていない
  （書き換えが要ると判断した場合は、実装前に理由を報告）
- 実装ノートを更新する。特に TPTS の swap がどこまで論文どおりか、
  残っている簡略化は何かを書くこと

# 報告してほしいこと

- 指摘 1 の原因（resting path が token に無かったのか、低レベルが見ていなかったのか）
- TPTS の swap をどの条件で発火させたか
- 指摘 3 が実装側だったのかプリセット側だったのか
- 全 MAPD プリセット × 全手法の service time / throughput / 衝突数の表
