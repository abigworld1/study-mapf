# Push and Swap

- algorithm-id: `push-and-swap`
- 調査日: 2026-07-27
- 担当: Codex

## 対象問題

connected undirected graph 上の pebble motion / one-shot MAPF。1 回の action では 1 agent だけが
隣接する空き vertex へ動く。原論文は `n <= |V|-2`、すなわち空き vertex 2 個以上を仮定する。
逐次 move を TimedPath の 1 timestep として記録するため vertex / edge-swap conflict は発生しない。
直前に空いた vertex へ入る操作はあるため、site の `forbidFollowing: true` は対象外として弾く。

## 原論文

- paper-id: `push-and-swap-ijcai-2011`
- 参照した節: §1.2、§2、§3、§3.1、§3.2、§5
- 参照したページ: PDF pp.2–7
- 参照した Algorithm 番号: Algorithm 1（p.2）、Algorithm 2（p.3）、Algorithm 3（p.3）

後続一次資料 `push-and-rotate-aamas-2013` の PDF pp.1–4 も、完全性反例の確認に使用した。

## 状態表現

agent から vertex への assignment、vertex から agent への occupancy、完了済み agent の goal 集合、
逐次 move の列。swap の試行中は一時 assignment と move 列を持ち、成功時だけ本体へ反映する。

## 遷移

`push` は planning agent の shortest path 上の blocker を最寄りの空き vertex へ押し出す。
`swap` は隣接する 2 agent を degree 3 以上の vertex まで `multipush` し、隣接する空き 2 vertex を
`clear` で作り、exchange 後に準備 move を agent 2 体だけ入れ替えて逆再生する。会議版の `clear` は
概略だけで欠落ケースがあるため、後続一次資料 Push and Rotate の 4-stage clear で補正する。

## 目的関数

feasible な逐次 move 列を得ること。PDF p.7 は path quality guarantee を目的にしないと明記する。

## ヒューリスティック

planning agent は goal への shortest path、push は blocker から最寄りの空き vertex、swap vertex は
planning agent から近い degree 3 以上の vertex を優先する。

## 終了条件

入力順の全 agent が goal に着けば成功。push と swap の両方が失敗すれば、この手法の探索を終了する。
後続論文が反例を示すため、その失敗を一般的な「解なし証明」とは表示しない。

## 理論保証

| 項目       | 値   | 根拠（原文とページ）                                                                                                                                            |
| ---------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完全性     | なし | 原論文 p.4 Theorem 3.1 は agent 数が vertex 数より 2 以上少ない条件で complete と主張するが、Push and Rotate p.1 と pp.2–4 が同じ条件内の反例と処理順依存を示す |
| 最適性     | なし | 原論文 p.7 §5 は solution quality guarantee を目的にしないと明記                                                                                                |
| 準最適保証 | なし | 原論文 p.6–7 の品質比較は実験値で bound ではない                                                                                                                |

### 保証が成立する条件

原論文の主張は connected graph と空き 2 vertex 以上だが、後続一次資料によりその条件だけでは
完全性が成立しない。したがって本サイトでは complete を主張しない。

## タイブレーク

原論文の agent priority は unspecified。ブラウザ版は既定で入力順とし、`extra.agentOrder` で明示順を
指定できる。shortest path、empty vertex、swap vertex の tie は vertex index 昇順。

## 論文中で未指定の箇所

- agent priority order
- 同距離 shortest path / empty vertex / swap vertex の tie
- `clear` の詳細な全ケース（会議版は概略で、後続資料が欠落ケースを指摘）
- 失敗を MAPF unsolvable と区別する API 表現

## 公開実装との差異

|                          | 方式                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 論文で定義された方式     | unspecified priority、Algorithms 1–3、任意の後処理 smoothing                                                        |
| 公開実装で採用された方式 | `pibt2` commit `faab5b91` は start-goal distance 降順、拡張 clear、既定 compression を使う                          |
| 今回のブラウザ実装       | 入力順、Algorithms 1–3 の push / multipush / exchange / reverse、後続論文の 4-stage clear、逐次 plan をそのまま表示 |
| 差異を選んだ理由         | tie を決定的にし、後続一次資料が示した clear の欠落ケースを補い、圧縮で原始操作の可視性を失わないため               |

`pibt2` の build は `third_party/grid-pathfinding/graph` と `third_party/googletest` の
submodule が未取得で CMake configure に失敗したため、固定 fixture の output 比較は未完了。

## 今回の実装方針

原論文コードを転記せず、PDF の操作仕様から独立実装する。全 move は空き隣接 vertex への単独移動として
検査し、swap 試行は transactional clone 上で行う。失敗結果には不完全手法である警告を付ける。

## 必要なテスト

- push だけで解ける例、swap が必要な例、空き 2 個未満の guard
- 成功解の全逐次 frame を `checkPaths()` で検査
- 後続論文が指摘する order dependency を保証表示へ反映
- `pibt2` の固定小規模 instance と success / validity を比較
- determinism、agent order option、abort / timeout / node limit、trace

## 未対応機能

solution smoothing / parallel compression、非 grid graph import、原論文の誤った completeness claim、
大規模 benchmark 全件の再現。
