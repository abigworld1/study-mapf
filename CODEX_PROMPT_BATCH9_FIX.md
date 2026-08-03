# Codex 用プロンプト — Batch 9 レビュー修正

> このファイルは Codex へそのまま貼るためのもの。`---` 以下を全部コピーして使う。

---

Batch 9 のレビューで 3 件見つかりました。1 件目が本体です。

先に良かった点を挙げます。既存 4 手法（`mapd-greedy` / TP / TPTS / CENTRAL）の
結果は 1 歩も変わっておらず、`tests/unit/mapd.test.ts` と
`tests/unit/batch8-mapd.test.ts` も無修正で通っています。拡張ループも
release → strategy → move → pickup/delivery の順序を保っています。
全 6 プリセット × 全手法で衝突 0。`canSolve` も正しく効いています。
小規模盤面で論文の傾向が再現しなかったことを隠さず報告した点も良いです。

# 指摘 1（重大）LNS-wPBS が LNS-PBS と同じ実装になっています

## 事実

6 プリセット全部で、LNS-PBS と LNS-wPBS の経路が byte 単位で一致します。

`src/solvers/mapd/batch9.ts` で `this.mode` を見ている箇所は 4 つだけです。

```text
 96: strategy: this.mode              ← イベントのラベル
100: this.mode === "rmca"             ← 分岐
187: this.mode === "rmca"             ← 分岐
257: algorithm: this.mode             ← イベントのラベル
```

**`"lns-pbs"` と `"lns-wpbs"` を区別する分岐が 1 つもありません。**
表示名が違うだけです。

窓もありません。`planSequence` の horizon は
`input.time + max(64, 面積 × 2)` で、これは全体計画の上限であって
rolling window ではありません。`planExpired` も「計画を使い切ったか」を
見ているだけです。

## 論文が定義していること

`mg-mapd-iros-2022` p.5：

> LNS-wPBS is a variant of LNS-PBS that, unlike LNS-PBS, uses **windowed PBS
> (wPBS) for planning collision-free paths for only the first w timesteps and
> then plan path again once the agents have moved for w timesteps**. This makes
> LNS-wPBS more efficient than LNS-PBS **but incomplete because there is no
> guarantee that the agents can reach their goal locations in a finite number
> of timesteps**.

同 p.1：

> LNS-wPBS uses the windowed MAPF algorithm of RHCR. Therefore, the runtime of
> LNS-wPBS is controlled by … **the user-specified size of the time window**

同 p.6（実験設定）：

> We set the time window of LNS-wPBS to **w = 10** timesteps.

**窓こそが LNS-wPBS の定義で、完全性を失う原因もそこ（shortsightedness）です。**

## `implementationNote` の理屈が逆です

いまこう書いてあります。

> RHCR の rolling window を**完全再現していないため**、論文の
> no-completeness guarantee を**保ちます**

窓を実装しないことで非保証が「保たれる」わけではありません。
非保証の原因である窓が無いだけで、それは LNS-wPBS ではないという意味です。
この書き方だと「実装していないほうが論文に忠実」と読めてしまいます。

## やること

**RHCR の windowed 再計画を LNS-wPBS の低レベルに繋いでください。**
Batch 6 で実装済みで、参考になるのは `src/solvers/lns/solvers.ts` の

- `rhcrSearchEnd`（968 行付近）— 探索は goal まで伸ばす
- `truncatePath` — 予約だけを窓の内側に切る
- 441 行付近の `episodeEnd = Math.min(horizon, currentTime + planningWindow)`

★ RHCR のときに一度間違えた点を繰り返さないでください。
**`w` は衝突を解消する先読みの長さであって、経路探索の上限ではありません。**
探索は goal まで伸ばし、予約と衝突解消だけを最初の `w` step に限定します。
`w` を探索の上限にすると、goal が `w` より遠いだけで失敗します。

守ること：

- 窓幅は `options.extra.windowSize`（無ければ `planningWindow`）で受け、
  既定は論文の実験設定に合わせて `w = 10`（同 p.6）。既定値の根拠をコメントに書く。
- `w` step 動いたら計画を引き直す（同 p.5「then plan path again once the
  agents have moved for w timesteps」）。
- **LNS-PBS 側は変えないこと。** LNS-PBS は窓を使いません。
- `implementationNote` を書き直す。「窓を実装した結果として完全性が無い」
  という因果に直すこと。
- **LNS-PBS と LNS-wPBS が異なる結果を出すことをテストで固定してください。**
  いまのプリセットで差が出ないなら、差が出るプリセットを 1 つ足すこと。
  窓が小さいほど shortsighted になるので、`w` を小さくすると詰まる／遅くなる
  ような盤面が作れるはずです。

# 指摘 2（軽）`rmca` と `regret-insertion` の `guarantee_evidence` が `null` です

Batch 8 では MLA\* / HBH について「定理を確認できなかった」ことを
`guarantee_evidence` に書きました。そちらが良い前例です。

```yaml
guarantee_evidence: "mla-star-icaps-2019 PDF pp.2–3（誌面 pp.182–183）Algorithm 1 を
  確認したが、MLA* 固有の完全性・最適性・準最適性を述べる定理・補題は確認できなかった。"
```

`null` だと「誰も調べていない」のか「調べたが無かった」のか区別が付きません。
RMCA 論文は読んでいるはずなので、**どこを見て何が無かったのかを書いてください。**

# 指摘 3（軽）`mapd-multi-goal` が何も判別しません

エージェント 1 体・タスク 1 件で、3 手法とも同一（service time 8.00）です。
品質ゲートの「多目的地プリセットを 1 つ以上」は満たしていますが、
**goal 列が複数あることの効果が見えません。**

goal を 1 つにした場合と差が出る形、あるいは goal の順序が結果を変える形に
してください。難しければ、なぜ差が出せないのかを報告してください。

# 完了条件

- 既存の品質ゲートが全部通る
  （`sources:validate errors=0` / format / lint / typecheck / unit / build / e2e）
- **既存 4 手法（`mapd-greedy` / TP / TPTS / CENTRAL）の結果が引き続き変わらない。**
  `tests/unit/mapd.test.ts` と `tests/unit/batch8-mapd.test.ts` が無修正で通ること
- **LNS-PBS と LNS-wPBS が異なる結果を出し、それがテストで固定されている**
- `runMapdLoop` の 1 ステップの順序を変えていない
- 全 MAPD プリセット × 全 MAPD 手法で、`solved` のとき衝突 0
- `lns-wpbs` の `guarantees.complete` が `true` でない（現状どおり `false`）

# 報告してほしいこと

- 窓をどこに入れたか。`w` が探索の上限ではなく衝突解消の範囲であることの確認方法
- 既定の `w` を何にしたか、その根拠
- LNS-PBS と LNS-wPBS の差が出るプリセットと、その実測値
- 指摘 3 が実装側だったのかプリセット側だったのか
- 全 MAPD プリセット × 全手法の service time / throughput / 衝突数の表
