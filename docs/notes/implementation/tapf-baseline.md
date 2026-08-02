# 全探索割当 + CBS（TAPF ベースライン）

- algorithm-id: `tapf-baseline`（サイト独自。`algorithms.yaml` の手法ではない）
- 調査日: 2026-08-01
- 担当: Claude Code

## これは何か

TAPF をブラウザで扱えるようにするための土台として置いた、素朴な参照実装。
**原論文の手法ではない。** チーム内の割当を全通り列挙し、それぞれを通常の
（非匿名）MAPF として CBS で解き、makespan が最小のものを返す。

置いた理由は 2 つ。

1. TAPF の入り口（モデル・プリセット・描画・割当表示）を作るとき、
   動く Solver が 1 つも無いと「選べるのに必ずエラー」になる。
   RHCR で一度その状態を作ってしまったので繰り返さない。
2. Batch 7 で CBM / CBS-TA を実装したとき、最適性を突き合わせる相手が要る。
   小さい問題なら全探索が確実に最適なので、オラクルとして使える。

## 対象問題

TAPF（target assignment and path finding）。定義は
`cbm-tapf-aamas-2016` p.2 §2.1 に従う。

- エージェントは K 個のチームに分割される。
- 各チームには、そのチームのエージェント数と**同じ数**の一意な target が与えられる。
- 各エージェントはチームの target のうち 1 つへ移動し、全 target が訪問される。
  チーム内の割当は 1 対 1 写像（順列）。
- 同じチームのエージェントは交換可能。違うチームのエージェントは交換不可。

同 p.1 は、この定式化が両極端を一般化すると述べている。

- チームが 1 つ（全エージェントが所属）→ 匿名 MAPF
- 各チームがちょうど 1 体 → 通常の（非匿名）MAPF

サイトのプリセットはこの 3 点が見えるように並べてある。

## 原論文

- paper-id: `cbm-tapf-aamas-2016`（TAPF の定義と makespan 目的、p.1–2）
- paper-id: `cbs-aij-2015`（内側で使う CBS）
- 参照した Algorithm 番号: なし（CBM のアルゴリズム自体は未実装）

## 目的関数

**makespan を最小化する。** CBM と同じ（`cbm-tapf-aamas-2016` p.2:
「the task is to find an optimal solution, namely one with minimal makespan」）。

★ ここは間違えやすい。**CBS-TA は sum of costs を最小化する**
（`cbs-ta-aamas-2018` p.2）。CBS-TA 論文 p.1 は CBM について
「minimizes the makespan …, which does not map well to minimizing idle time,
where the sum of all costs is a better metric」と書いており、両者を明確に
区別している。サイトの画面は SOC と makespan を両方出すので、
どちらを最適化したのかを `SolverResult.objective` で必ず添える。
添えないと「表示されている数値はどれも最適」と読まれる（SOURCE_POLICY.md 第 8 条）。

## 状態表現

チーム定義（`TeamSpec`）と、agentId → target の割当写像。
割当を固定すると通常の one-shot MAPF インスタンスになるので、
そこから先は既存の CBS にそのまま渡す。

## 終了条件

全組合せを評価し終えたら、その中の makespan 最小を返す。
時間切れ・abort で途中打ち切りになった場合は、そこまでの最良解を返しつつ
「全て評価していない」ことを警告に出す。1 つも解けなかった場合も、
完走したときだけ `no-solution` を名乗る。

## タイブレーク

makespan が同じ解が複数あるときは sum of costs が小さいほうを選ぶ。

★ これは**独自ルール**。`cbm-tapf-aamas-2016` は makespan についてのみ
最適性を主張しており、同値の解のうちどれを返すかは決めていない。
決定的な出力にするために足した。

## 計算量と上限

組合せ数は各チームの `K_i!` の積。1 通りごとに CBS を丸ごと 1 回走らせる。

| チーム構成 | 組合せ数 |
| ---------- | -------- |
| 4 体 × 1   | 24       |
| 2 体 × 2   | 4        |
| 7 体 × 1   | 5040     |
| 8 体 × 1   | 40320    |

`MAX_ASSIGNMENTS = 5040` を超える入力は構造化エラーで拒否する。

★ この scalability の悪さは実装の都合ではなく手法の性質で、
`cbm-tapf-aamas-2016` p.2 が
「searching over all assignments of agents to targets to find optimal solutions」
を、scalability に難があるやり方として名指ししている。
CBM や CBS-TA はまさにここを避けるための手法なので、
この実装は「なぜ CBM が要るのか」を示す対照として機能する。

## 理論保証

| 項目       | 値                                 | 根拠                                                                                                   |
| ---------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 完全性     | あり（上限内・CBS が完走する限り） | 全割当を列挙し、各々を完全な CBS で解くため。ただし CBS 側が maxHorizon 等で打ち切られた場合は対象外。 |
| 最適性     | makespan について あり（同上）     | 全割当を尽くすため。sum of costs については主張しない。                                                |
| 準最適保証 | なし                               | —                                                                                                      |

★ この保証はサイト独自実装についてのもので、論文が与えた保証ではない。
`algorithms.yaml` には登録しない（論文手法ではないため）。

## 論文中で未指定の箇所

同値解のタイブレーク。上に書いたとおり SOC で決めている。

## 今回の実装方針

`enumerateAssignments` でチームごとの順列の直積を作り、`withAssignment` で
`kind: "one-shot-mapf"` の Scenario に変換して `solveCbsVariant` を呼ぶ。
内側の CBS のイベントは捨てる（組合せ数 × CT 展開数で UI が固まるため）。
時間予算は組合せ数で割って各 CBS に渡し、全体の締切も毎回見る。

## Batch 7 への引き継ぎ

- **CBS-TA はチームではなく割当行列 A を使う**（`cbs-ta-aamas-2018` p.2）。
  エージェント数と goal 数が違う場合、エージェントごとに割当可能な goal が
  違う場合も扱える。チーム分割はその特殊形（ブロック対角）なので、
  CBS-TA を実装するときは `TeamSpec` から行列表現への拡張が要る。
  いまのモデルは CBM 側に寄せてある。
- CBM の低レベルは時空間ネットワーク上の最小費用流（同 p.2 Theorem 1）。
  `min-cost-max-flow` を先に実装すると CBM がそれを使える。
- この実装は小規模なら確実に makespan 最適なので、CBM の最適性検証に使う。
  CBS-TA は目的関数が違うので、**そのまま突き合わせてはいけない**。

## 必要なテスト

- チームの不変条件（target 数 = エージェント数、target 重複なし、孤立エージェントなし）
- JSON 往復でチームが保たれる
- 並び順ではなく最適な割当を選ぶ（`tapf-crossing` は makespan 6、並び順なら 10）
- 各エージェントが自チームの target をちょうど 1 つ取る
- 目的関数と全探索であることの警告
- 同じ seed で同じ結果
- TAPF 以外の Scenario と上限超過の拒否
- `Scenario.kind` による Solver 絞り込み（全 kind で supports と一致すること）

## Batch 7 実装後の状態

CBM は `src/solvers/tapf/cbm.ts`、CBS-TA は `src/solvers/tapf/cbs-ta.ts` に実装済み。
CBS-TA の SOC 検証にはこの makespan baseline を使わず、候補列挙＋CBS の SOC 選択をテスト専用オラクルとして使う。

## 未対応機能

ECBS-TA と、論文どおりの遅延 K-best search forest。CBS-TA の矩形行列では、エージェント数が target 数より多い場合は余剰 agent を start に留め、target 数が多い場合は余剰 target を未割当として扱う（解説ページで明示）。
