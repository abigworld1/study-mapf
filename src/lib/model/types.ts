/**
 * MAPF / MAPD シミュレータの共通ドメインモデル。
 *
 * ★ ここで定義するモデルは 1 つの具体的なルールに固定している。
 *   別のルールを扱う場合は Scenario.rules に保存し、暗黙に変えないこと。
 *   （SOURCE_POLICY.md 第 8 条: 用語と保証を混同しない）
 *
 * 既定のモデル:
 *   - 4 近傍グリッド（上下左右）。斜め移動なし
 *   - 離散時間。1 タイムステップで move（隣接セルへ 1 歩）または wait（その場）
 *   - vertex conflict:    同時刻に 2 体が同じセルを占有する
 *   - edge-swap conflict: 隣り合う 2 体が同一ステップで位置を入れ替える
 *   - goal 到達後は既定で stay（そこに居続け、他エージェントを妨げる）
 *   - goal 到達後に disappear するモードも選べる
 *
 * 用語は mapf-benchmarks-2019（Stern et al., SoCS 2019）の定義に合わせている。
 */

// ---------------------------------------------------------------- 基本

/** グリッド上のセル。左上原点、x は列、y は行。 */
export interface Cell {
  readonly x: number;
  readonly y: number;
}

export type AgentId = string;
export type TaskId = string;

/** 離散時刻。0 始まり。 */
export type Time = number;

/** 4 近傍の移動方向。wait は移動しない。 */
export type MoveDirection = "up" | "down" | "left" | "right" | "wait";

// ---------------------------------------------------------------- マップ

/**
 * グリッドマップ。
 * blocked は width*height の真偽値配列で、index = y * width + x。
 * 配列を使うのは Web Worker への転送コストを抑えるため。
 */
export interface GridMap {
  readonly width: number;
  readonly height: number;
  /** true = 通行不可（壁） */
  readonly blocked: readonly boolean[];
  /** 由来を残す。Moving AI の .map から読んだ場合はファイル名など。 */
  readonly source?: string;
}

// ---------------------------------------------------------------- エージェントとタスク

export interface AgentSpec {
  readonly id: AgentId;
  readonly start: Cell;
  /**
   * one-shot MAPF のゴール。
   * MAPD ではエージェントに固定ゴールが無いため undefined になりうる。
   */
  readonly goal?: Cell;
  /** 表示用の色 index。色だけに依存しないよう、UI では形と記号も併用する。 */
  readonly colorIndex?: number;
}

/**
 * MAPD のタスク。pickup へ行き、そこから delivery へ運ぶ。
 * releaseTime はタスクが系に現れる時刻。
 */
export interface TaskSpec {
  readonly id: TaskId;
  readonly pickup: Cell;
  readonly delivery: Cell;
  readonly releaseTime: Time;
}

// ---------------------------------------------------------------- シナリオ

/** ゴール到達後の扱い。保証の議論が変わるため必ず明示する。 */
export type GoalBehavior = "stay" | "disappear";

/** 問題の種別。 */
export type ProblemKind = "one-shot-mapf" | "lifelong-mapf" | "mapd" | "tapf";

/**
 * シミュレーションのルール。既定から外れる設定はここに保存する。
 * 「ルールが違う場合はシナリオ設定に保存する」という要件に対応する。
 */
export interface SimulationRules {
  readonly goalBehavior: GoalBehavior;
  /** 隣接 2 体の入れ替わりを禁止するか。既定 true。 */
  readonly forbidEdgeSwap: boolean;
  /**
   * 直前に他エージェントが居たセルへ同ステップで入るのを禁止するか（following conflict）。
   * 既定 false。ロボットの物理的制約を模す場合に true。
   */
  readonly forbidFollowing: boolean;
  /** 斜め移動を許すか。既定 false（4 近傍）。 */
  readonly allowDiagonal: boolean;
}

export const DEFAULT_RULES: SimulationRules = {
  goalBehavior: "stay",
  forbidEdgeSwap: true,
  forbidFollowing: false,
  allowDiagonal: false,
};

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly kind: ProblemKind;
  readonly map: GridMap;
  readonly agents: readonly AgentSpec[];
  /** MAPD / lifelong の場合のみ使う。 */
  readonly tasks?: readonly TaskSpec[];
  readonly rules: SimulationRules;
  /** 乱数 seed。同じ seed と同じ入力なら同じ結果になること。 */
  readonly seed: number;
  /** 出典があるシナリオ（Moving AI 等）はここに書く。 */
  readonly attribution?: string;
}

// ---------------------------------------------------------------- 経路

export interface TimedPosition {
  readonly time: Time;
  readonly cell: Cell;
}

/** 1 エージェントの経路。時刻 0 から連続していること。 */
export interface TimedPath {
  readonly agentId: AgentId;
  readonly positions: readonly TimedPosition[];
}

// ---------------------------------------------------------------- 衝突と制約

export type ConflictKind = "vertex" | "edge-swap" | "following";

export interface VertexConflict {
  readonly kind: "vertex";
  readonly agentA: AgentId;
  readonly agentB: AgentId;
  readonly cell: Cell;
  readonly time: Time;
}

export interface EdgeSwapConflict {
  readonly kind: "edge-swap";
  readonly agentA: AgentId;
  readonly agentB: AgentId;
  /** A が time-1 → time で from → to へ動き、B が逆へ動いた。 */
  readonly from: Cell;
  readonly to: Cell;
  readonly time: Time;
}

export interface FollowingConflict {
  readonly kind: "following";
  readonly agentA: AgentId;
  readonly agentB: AgentId;
  readonly cell: Cell;
  readonly time: Time;
}

export type Conflict = VertexConflict | EdgeSwapConflict | FollowingConflict;

/**
 * 低レベル探索へ渡す制約。CBS 系の可視化で使う。
 * positive は disjoint splitting（「必ずそこを通れ」）用。
 */
export interface VertexConstraint {
  readonly kind: "vertex";
  readonly agentId: AgentId;
  readonly cell: Cell;
  readonly time: Time;
  readonly positive?: boolean;
}

export interface EdgeConstraint {
  readonly kind: "edge";
  readonly agentId: AgentId;
  readonly from: Cell;
  readonly to: Cell;
  readonly time: Time;
  readonly positive?: boolean;
}

export type Constraint = VertexConstraint | EdgeConstraint;

// ---------------------------------------------------------------- 予約表

/**
 * 予約表。cooperative-pathfinding-2005 の reservation table に相当する。
 * 実装は src/lib/model/reservation.ts。
 */
export interface ReservationTable {
  /** (cell, time) が予約済みか。除外したいエージェントを渡せる。 */
  isReserved(cell: Cell, time: Time, exceptAgent?: AgentId): boolean;
  /** from→to の辺が time に逆向きで使われているか（edge swap 検出用）。 */
  isEdgeReserved(from: Cell, to: Cell, time: Time, exceptAgent?: AgentId): boolean;
  reserve(agentId: AgentId, cell: Cell, time: Time): void;
  reservePath(path: TimedPath, horizon: Time): void;
  clearAgent(agentId: AgentId): void;
  /** 可視化用。指定時刻に予約されているセルを返す。 */
  reservedAt(time: Time): readonly { cell: Cell; agentId: AgentId }[];
}

// ---------------------------------------------------------------- 実行結果

/**
 * 実行統計。
 *
 * ★ 計測していない項目は 0 を入れずに undefined のままにすること。
 *   0 は「数えた結果 0 だった」を意味する。捏造すると比較表が嘘になる。
 */
export interface SolverMetrics {
  /** 各エージェントのコストの総和。goal 到達までの時刻の和。 */
  readonly sumOfCosts: number;
  /** 全エージェントが完了する時刻。 */
  readonly makespan: number;
  /** 計画に要した実時間（ms）。 */
  readonly runtimeMs: number;

  /** 展開した（= OPEN から取り出した）ノード数。 */
  readonly expandedNodes?: number;
  /** 生成した（= 後継として作った）ノード数。展開数より多くなる。 */
  readonly generatedNodes?: number;
  /** 検出した衝突の総数。SolverResult.conflicts は「残った」衝突なので別物。 */
  readonly conflictsDetected?: number;
  /** 低レベル探索を呼び直した回数（CBS の再計画、LNS の修復など）。 */
  readonly replans?: number;
  /** 探索中に得られたコスト下界。最適解法なら最終的に sumOfCosts と一致する。 */
  readonly lowerBound?: number;
  /**
   * 得られた解の準最適性の上界。`sumOfCosts / lowerBound` など。
   * 有界準最適解法は options.suboptimalityFactor 以下であること。
   */
  readonly suboptimalityBound?: number;

  /** MAPD: タスクの発生から配達完了までの平均時間。 */
  readonly averageServiceTime?: number;
  /** MAPD: 単位時間あたりの完了タスク数。 */
  readonly throughput?: number;
  /** MAPD: 未処理タスク数。 */
  readonly pendingTasks?: number;
}

export type SolverOutcome =
  "solved" | "no-solution" | "timeout" | "node-limit" | "aborted" | "error";

/** 失敗の理由。outcome だけでは足りない場合に添える。 */
export type FailureReason =
  | "unreachable-goal"
  | "start-blocked"
  | "goal-blocked"
  | "priority-order"
  | "search-exhausted"
  | "limit-exceeded"
  | "unsupported-rules"
  | "not-implemented"
  | "internal";

/** 実行中に気づいた注意点。致命的ではないが利用者へ伝えるべきもの。 */
export interface SolverWarning {
  readonly code:
    | "input-too-large"
    | "trace-truncated"
    | "option-ignored"
    | "simplified-behavior"
    | "nondeterminism-risk";
  readonly message: string;
}

export interface SolverResult {
  readonly outcome: SolverOutcome;
  readonly paths: readonly TimedPath[];
  readonly metrics: SolverMetrics;
  /** 解に残っている衝突。solved なら空であること。 */
  readonly conflicts: readonly Conflict[];
  /** MAPD の割当履歴。 */
  readonly assignments?: readonly { taskId: TaskId; agentId: AgentId; time: Time }[];
  /** outcome が error のときの構造化情報。 */
  readonly error?: SolverErrorInfo;
  /** outcome が solved 以外のときの分類。error より粗いが outcome より細かい。 */
  readonly failureReason?: FailureReason;
  /** 実行中の注意点。空配列ではなく未設定なら省略してよい。 */
  readonly warnings?: readonly SolverWarning[];
  /**
   * 記録したイベント列。options.traceLevel が "off" 以外のときだけ入る。
   * 上限を超えた場合は打ち切り、warnings に "trace-truncated" を入れる。
   */
  readonly trace?: readonly SolverEvent[];
}

export interface SolverErrorInfo {
  readonly code: "not-implemented" | "invalid-scenario" | "internal" | "unsupported-rules";
  readonly message: string;
  /** スタックは開発時のみ。本番表示には使わない。 */
  readonly detail?: string;
}

// ---------------------------------------------------------------- 実行オプション

/**
 * トレースの詳細度。
 * 手法によってはイベントが爆発するため、UI から段階的に絞れるようにしている。
 */
export type TraceLevel = "off" | "summary" | "detailed" | "verbose";

export interface SolverOptions {
  /** ミリ秒。超えたら outcome: "timeout"。 */
  readonly timeoutMs: number;
  /** 展開ノードの上限。超えたら outcome: "node-limit"。 */
  readonly maxExpansions: number;
  /** 乱数 seed。Scenario.seed と別に上書きしたい場合。 */
  readonly seed?: number;
  /** 有界準最適解法の w。対応しない解法は無視する。 */
  readonly suboptimalityFactor?: number;
  /** lifelong / MAPD のシミュレーション打ち切り時刻。 */
  readonly horizon?: number;

  // --- 安全弁 ---
  // ブラウザ内で動く教材なので、入力が大きすぎるとタブごと固まる。
  // Solver は実行前に assertWithinLimits() で弾くこと（src/solvers/limits.ts）。
  /** エージェント数の上限。 */
  readonly maxAgents: number;
  /** グリッド面積（width × height）の上限。 */
  readonly maxGridArea: number;
  /** 探索する最大時刻。 */
  readonly maxHorizon: number;
  /** 記録するイベント数の上限。超えたら打ち切り、warnings に残す。 */
  readonly maxTraceEvents: number;

  /** トレースの詳細度。既定は "summary"。 */
  readonly traceLevel: TraceLevel;

  /** アルゴリズム固有の設定。型は各 Solver が検証する。 */
  readonly extra?: Readonly<Record<string, unknown>>;
}

export const DEFAULT_SOLVER_OPTIONS: SolverOptions = {
  timeoutMs: 10_000,
  maxExpansions: 2_000_000,
  maxAgents: 200,
  maxGridArea: 40_000,
  maxHorizon: 2_000,
  maxTraceEvents: 20_000,
  traceLevel: "summary",
};

export interface SimulationOptions {
  /** 再生速度（1 ステップあたりの ms）。 */
  readonly stepDurationMs: number;
  /** 経路を描くか。 */
  readonly showPaths: boolean;
  /** 予約表を描くか。 */
  readonly showReservations: boolean;
  /** 衝突を強調するか。 */
  readonly showConflicts: boolean;
  /** prefers-reduced-motion を尊重して補間を切る。 */
  readonly reduceMotion: boolean;
}

// ---------------------------------------------------------------- イベント

/**
 * Solver の内部動作を UI へ流すためのイベント。
 *
 * ★ 描画側は Solver の内部状態を直接見てはならない。
 *   このイベント列、または保存されたフレームだけを再生する。
 *   そうしておくと、後から追加される解法（CBS、PIBT、LNS…）でも
 *   描画コードを変えずに可視化できる。
 */
export type SolverEvent =
  /** 低レベル探索がノードを展開した。state は解法ごとに異なるため unknown。 */
  | { readonly type: "expand-node"; readonly agentId?: AgentId; readonly state: unknown }
  /** 予約表へ (cell, time) を登録した。 */
  | {
      readonly type: "reserve";
      readonly agentId: AgentId;
      readonly cell: Cell;
      readonly time: Time;
    }
  | { readonly type: "detect-conflict"; readonly conflict: Conflict }
  | { readonly type: "add-constraint"; readonly constraint: Constraint }
  /** 優先順位を決めた（PBS など）。 */
  | { readonly type: "set-priority"; readonly higher: AgentId; readonly lower: AgentId }
  /** 優先度継承（PIBT）。 */
  | { readonly type: "inherit-priority"; readonly from: AgentId; readonly to: AgentId }
  | { readonly type: "backtrack"; readonly agentId?: AgentId }
  /** LNS: 近傍を破壊した。 */
  | { readonly type: "destroy-neighborhood"; readonly agentIds: readonly AgentId[] }
  | { readonly type: "repair-neighborhood"; readonly agentIds: readonly AgentId[] }
  | { readonly type: "assign-task"; readonly taskId: TaskId; readonly agentId: AgentId }
  /** 1 タイムステップ分の全エージェント位置。アニメーションの基本フレーム。 */
  | {
      readonly type: "move";
      readonly time: Time;
      readonly positions: Readonly<Record<AgentId, Cell>>;
    }
  /** 進捗通知。0..1。 */
  | { readonly type: "progress"; readonly ratio: number; readonly label?: string }
  | { readonly type: "finish"; readonly result: SolverResult }
  // ------------------------------------------------------------ 時空間探索 / SIPP
  /** SIPP: 安全区間を見つけた。 */
  | {
      readonly type: "discover-safe-interval";
      readonly agentId: AgentId;
      readonly cell: Cell;
      readonly from: Time;
      readonly to: Time;
    }
  /** 予約済みのため後継を捨てた。なぜ待つのかを見せる。 */
  | {
      readonly type: "reject-reserved-state";
      readonly agentId: AgentId;
      readonly cell: Cell;
      readonly time: Time;
      readonly reason: "vertex" | "edge-swap" | "following";
    }
  // ------------------------------------------------------------ CBS 系
  /** 衝突を cardinal / semi-cardinal / non-cardinal などに分類した。 */
  | {
      readonly type: "classify-conflict";
      readonly conflict: Conflict;
      readonly classification: "cardinal" | "semi-cardinal" | "non-cardinal" | "unknown";
    }
  /** 制約木のノードを作った。 */
  | {
      readonly type: "create-ct-node";
      readonly nodeId: string;
      readonly parentId?: string;
      readonly cost: number;
      readonly constraintCount: number;
    }
  /** 低レベル探索をやり直した。 */
  | { readonly type: "low-level-replan"; readonly agentId: AgentId; readonly nodeId?: string }
  /** バイパス（子ノードを作らず経路だけ差し替え）した。 */
  | { readonly type: "bypass"; readonly agentId: AgentId; readonly conflict: Conflict }
  // ------------------------------------------------------------ PBS
  /** 優先順位の半順序（DAG）を更新した。 */
  | {
      readonly type: "update-priority-dag";
      readonly edges: readonly { higher: AgentId; lower: AgentId }[];
    }
  /** 優先度の低いエージェントを計画し直した。 */
  | { readonly type: "replan-lower-priority-agent"; readonly agentId: AgentId }
  // ------------------------------------------------------------ PIBT
  /** このステップの優先順位。 */
  | { readonly type: "priority-order"; readonly time: Time; readonly order: readonly AgentId[] }
  /** 候補セルを評価した。 */
  | {
      readonly type: "candidate-evaluation";
      readonly agentId: AgentId;
      readonly candidates: readonly { cell: Cell; score: number }[];
    }
  // ------------------------------------------------------------ ICTS / M*
  | {
      readonly type: "create-ict-node";
      readonly nodeId: string;
      readonly costs: readonly number[];
      readonly totalCost: number;
    }
  | {
      readonly type: "build-mdd";
      readonly agentId: AgentId;
      readonly cost: number;
      readonly nodeCount: number;
    }
  | {
      readonly type: "prune-ict-node";
      readonly nodeId: string;
      readonly reason: "pairwise" | "horizon" | "duplicate";
    }
  | {
      readonly type: "update-collision-set";
      readonly configId: string;
      readonly agentIds: readonly AgentId[];
    }
  | {
      readonly type: "backpropagate-collision";
      readonly fromConfigId: string;
      readonly toConfigId: string;
      readonly agentIds: readonly AgentId[];
    }
  // ------------------------------------------------------------ Push 系
  | {
      readonly type: "push-agent";
      readonly agentId: AgentId;
      readonly from: Cell;
      readonly to: Cell;
      readonly reason: "plan" | "clear" | "multipush" | "resolve";
    }
  | { readonly type: "clear-vertex"; readonly cell: Cell; readonly emptyCell: Cell }
  | {
      readonly type: "swap-agents";
      readonly agentA: AgentId;
      readonly agentB: AgentId;
      readonly phase: "start" | "finish";
    }
  | {
      readonly type: "rotate-cycle";
      readonly agentIds: readonly AgentId[];
      readonly cells: readonly Cell[];
    }
  | {
      readonly type: "create-subproblem";
      readonly subproblemId: string;
      readonly cells: readonly Cell[];
      readonly agentIds: readonly AgentId[];
    }
  // ------------------------------------------------------------ LaCAM
  /** 構成（全エージェント位置の組）を展開した。 */
  | { readonly type: "configuration-expand"; readonly configId: string; readonly depth: number }
  /** 低レベルノード（制約候補）を作った。 */
  | { readonly type: "create-low-level-node"; readonly configId: string; readonly agentId: AgentId }
  /** 遅延制約を追加した。 */
  | {
      readonly type: "add-lazy-constraint";
      readonly configId: string;
      readonly agentId: AgentId;
      readonly cell: Cell;
    }
  /** 新しい構成を生成した。 */
  | {
      readonly type: "configuration-generate";
      readonly configId: string;
      readonly positions: Readonly<Record<AgentId, Cell>>;
    }
  /** LaCAM*: 既知 configuration graph の shortest-path tree を張り替えた。 */
  | {
      readonly type: "rewire-configuration";
      readonly configId: string;
      readonly parentConfigId: string;
      readonly previousCost: number;
      readonly newCost: number;
    }
  // ------------------------------------------------------------ LNS
  /** 近傍を選んだ（破壊する前）。 */
  | {
      readonly type: "select-neighborhood";
      readonly agentIds: readonly AgentId[];
      readonly strategy: string;
    }
  | { readonly type: "accept-solution"; readonly cost: number; readonly iteration: number }
  | { readonly type: "reject-solution"; readonly cost: number; readonly iteration: number }
  /** 暫定解を更新した。 */
  | { readonly type: "update-incumbent"; readonly cost: number; readonly iteration: number }
  // ------------------------------------------------------------ MAPD
  | { readonly type: "release-task"; readonly taskId: TaskId; readonly time: Time }
  | {
      readonly type: "swap-task";
      readonly taskId: TaskId;
      readonly from: AgentId;
      readonly to: AgentId;
      readonly time: Time;
    }
  | {
      readonly type: "pickup";
      readonly taskId: TaskId;
      readonly agentId: AgentId;
      readonly time: Time;
    }
  | {
      readonly type: "delivery";
      readonly taskId: TaskId;
      readonly agentId: AgentId;
      readonly time: Time;
    }
  /** Token Passing のトークン更新。 */
  | { readonly type: "update-token"; readonly agentId: AgentId; readonly time: Time }
  /** 汎用の再計画通知。どの手法でも使える。 */
  | { readonly type: "replan"; readonly agentIds: readonly AgentId[]; readonly reason: string };

/** SolverEvent の type だけを取り出したもの。トレースの絞り込みに使う。 */
export type SolverEventType = SolverEvent["type"];

// ---------------------------------------------------------------- Solver

export type SolverCategory =
  | "basic-search"
  | "space-time-search"
  | "prioritized-planning"
  | "cbs"
  | "icts-joint-mstar"
  | "pibt-lacam"
  | "push"
  | "lns"
  | "lifelong"
  | "mapd"
  | "tapf"
  | "learning";

/** サイト上の実装状態。誤認を避けるため UI で必ず表示する。 */
export type ImplementationStatus = "runnable" | "partial" | "explanation-only" | "planned";

/**
 * 実装が原論文をどこまで再現しているか。
 *
 * ★ ImplementationStatus（動くかどうか）とは別軸である。
 *   「動く」ことと「原論文どおり」は違う。両方を表示する。
 *
 *   educational          原理を学ぶための簡略実装。論文の改良は入っていない
 *   paper-faithful       原論文の主要処理を実装した
 *   reference-validated  公開実装または既知結果と照合済み
 *   explanation-only     実行可能な再現実装は無い
 *
 * ★ 一部だけ実装した状態を reference-validated にしてはならない。
 *   照合したのは「何を」なのかを implementationNote に書くこと。
 */
export type FidelityLevel =
  "educational" | "paper-faithful" | "reference-validated" | "explanation-only";

export interface SolverMetadata {
  /** algorithms.yaml の algorithm-id と一致させること。 */
  readonly id: string;
  readonly displayName: string;
  /** 原語表記。UI で併記する。 */
  readonly originalName: string;
  readonly category: SolverCategory;
  readonly supports: readonly ProblemKind[];
  readonly status: ImplementationStatus;
  /** 原論文の再現度。status とは別軸。 */
  readonly fidelity: FidelityLevel;
  /**
   * この実装が対応できないルール。合わない Scenario が来たら
   * outcome: "error", code: "unsupported-rules" を返す。
   */
  readonly unsupportedRules?: readonly (keyof SimulationRules)[];
  /**
   * reference-validated のときの照合先。
   * 何と、どのインスタンスで、何を比べたかを書く。
   */
  readonly validatedAgainst?: readonly string[];
  /** 実装の根拠にした論文 ID（papers.yaml）。 */
  readonly basedOnPaperIds?: readonly string[];
  /**
   * この実装が原論文の完全な再現ではないことの断り書き。
   * runnable でも簡略化している場合は必ず書く。
   */
  readonly implementationNote?: string;
}

export interface SolverContext {
  /** 中断。UI の「停止」やページ遷移で発火する。 */
  readonly signal: AbortSignal;
  /** イベント通知。Worker からは postMessage 経由で UI へ届く。 */
  emit(event: SolverEvent): void;
  /** 決定性のある乱数。seed から作られる。Math.random を直接使わないこと。 */
  random(): number;
  /** 現在時刻（ms）。タイムアウト判定に使う。テストで差し替えられるようにしている。 */
  now(): number;
}

export interface MapfSolver {
  readonly metadata: SolverMetadata;
  solve(scenario: Scenario, options: SolverOptions, context: SolverContext): Promise<SolverResult>;
}
