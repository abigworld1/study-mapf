import type {
  MapfSolver,
  SolverContext,
  SolverMetadata,
  SolverOptions,
  SolverResult,
  Scenario,
  SolverWarning,
} from "@/lib/model/types.js";
import { solveCbsVariant, type CbsRunConfig, type CbsVariant } from "./core.js";

const COMMON_UNSUPPORTED = ["allowDiagonal", "goalBehavior"] as const;
const DEFAULT_BOUND = 1.5;
const DEFAULT_MERGE_THRESHOLD = 1;
const MAX_META_AGENT_SIZE = 3;

export const cbsSolver = createSolver(
  {
    id: "cbs",
    displayName: "CBS",
    originalName: "Conflict-Based Search",
    category: "cbs",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: COMMON_UNSUPPORTED,
    basedOnPaperIds: ["cbs-aij-2015", "cbs-aaai-2012"],
    implementationNote:
      "AIJ 2015 Algorithm 2 の CBS 部分を再現。SOC/conflict 数/FIFO の CT tie-break と CAT low-level tie-break を実装する。有限 maxHorizon と安全上限で打ち切られた実行は理論保証の対象外。",
  },
  "cbs",
);

export const bcbsSolver = createSolver(
  {
    id: "bcbs",
    displayName: "BCBS",
    originalName: "Bounded CBS",
    category: "cbs",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: COMMON_UNSUPPORTED,
    basedOnPaperIds: ["bcbs-ecbs-socs-2014"],
    implementationNote:
      "高・低レベル focal search の係数積 wH*wL を保証値とする。既定は suboptimalityFactor を sqrt(w) ずつ配分し、extra.highLevelWeight / lowLevelWeight で両方を明示できる。",
  },
  "bcbs",
);

export const ecbsSolver = createSolver(
  {
    id: "ecbs",
    displayName: "ECBS",
    originalName: "Enhanced CBS",
    category: "cbs",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: COMMON_UNSUPPORTED,
    basedOnPaperIds: ["bcbs-ecbs-socs-2014"],
    implementationNote:
      "low-level FOCAL が返す fMin の和を CT lower bound とし、cost<=w*LB の high-level FOCAL を conflict 数で選ぶ。既定 w=1.5。",
  },
  "ecbs",
);

export const icbsSolver = createSolver(
  {
    id: "icbs",
    displayName: "ICBS (PC+BP)",
    originalName: "Improved Conflict-Based Search",
    category: "cbs",
    supports: ["one-shot-mapf"],
    status: "partial",
    fidelity: "paper-faithful",
    unsupportedRules: COMMON_UNSUPPORTED,
    basedOnPaperIds: ["icbs-ijcai-2015", "cbs-aij-2015"],
    implementationNote:
      "cardinal/semi/non-cardinal prioritization と helpful bypass を実装。分類は MDD と等価な child-cost 判定を使う。論文の完全版 ICBS(25) に含まれる MA-CBS merge / merge-and-restart は未実装。",
  },
  "icbs",
);

export const eecbsSolver = createSolver(
  {
    id: "eecbs",
    displayName: "EECBS",
    originalName: "Explicit Estimation CBS",
    category: "cbs",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: COMMON_UNSUPPORTED,
    basedOnPaperIds: ["eecbs-aaai-2021", "bcbs-ecbs-socs-2014"],
    implementationNote:
      "AAAI 2021 §3 の基礎 EECBS: CLEANUP/OPEN/FOCAL の EES 選択、online one-step error、bounded low level を実装。§4 の relaxed bypass、PC、symmetry reasoning、WDG は未実装。既定 w=1.5。",
  },
  "eecbs",
);

export const disjointSplittingSolver = createSolver(
  {
    id: "disjoint-splitting",
    displayName: "Disjoint Splitting",
    originalName: "Disjoint Splitting for CBS",
    category: "cbs",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: COMMON_UNSUPPORTED,
    basedOnPaperIds: ["disjoint-splitting-icaps-2019", "cbsh2-rtc-aij-2021"],
    implementationNote:
      "同じ agent の negative / positive constraint で排他的に分岐する。positive constraint は他 agent への暗黙の禁止も強制する。split agent は論文 p.3 §4.2 の Random 方策を seeded random で選び、conflict 自体は既存 CBS の earliest 規則を維持する。landmark 間だけの再探索と MDD 選択方策は未実装。",
  },
  "disjoint-splitting",
);

export const cbshSolver = createSolver(
  {
    id: "cbsh",
    displayName: "CBSH",
    originalName: "CBS with Heuristics",
    category: "cbs",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: COMMON_UNSUPPORTED,
    basedOnPaperIds: ["cbsh-icaps-2018", "icbs-ijcai-2015"],
    implementationNote:
      "cardinal conflict graph の minimum vertex cover を CT の許容 h に使う。関与 agent 18 体以下では厳密探索し、それを超える場合は許容性を保つ maximal matching 下界へ切り替える。PC+BP を併用し、cardinal edge が無い node は h=0 として zero-cost bypass 条件を守る。",
  },
  "cbsh",
);

export const maCbsSolver = createSolver(
  {
    id: "ma-cbs",
    displayName: "MA-CBS",
    originalName: "Meta-Agent Conflict-Based Search",
    category: "cbs",
    supports: ["one-shot-mapf"],
    status: "runnable",
    fidelity: "paper-faithful",
    unsupportedRules: COMMON_UNSUPPORTED,
    basedOnPaperIds: ["ma-cbs-socs-2012", "cbs-aij-2015"],
    implementationNote:
      "衝突回数が B を超えた group を meta-agent に併合し、最大 3 体の制約付き joint-state A* で SOC 最適に再計画する。既定 B=1、extra.mergeThreshold で 0〜Infinity を指定できる。3 体を超える併合要求は node-limit と警告で正直に打ち切る。Merge-and-Restart は未実装。",
  },
  "ma-cbs",
);

function createSolver(metadata: SolverMetadata, variant: CbsVariant): MapfSolver {
  return {
    metadata,
    async solve(
      scenario: Scenario,
      options: SolverOptions,
      context: SolverContext,
    ): Promise<SolverResult> {
      return solveCbsVariant(scenario, options, context, resolveConfig(variant, options));
    },
  };
}

function resolveConfig(variant: CbsVariant, options: SolverOptions): CbsRunConfig {
  if (variant === "ma-cbs") {
    const rawThreshold = options.extra?.mergeThreshold;
    const mergeThreshold = rawThreshold === undefined ? DEFAULT_MERGE_THRESHOLD : rawThreshold;
    if (
      typeof mergeThreshold !== "number" ||
      mergeThreshold < 0 ||
      (!Number.isInteger(mergeThreshold) && mergeThreshold !== Number.POSITIVE_INFINITY)
    ) {
      return {
        variant,
        lowLevelWeight: 1,
        highLevelWeight: 1,
        optionError:
          "MA-CBS の extra.mergeThreshold は 0 以上の整数または Infinity にしてください。",
      };
    }
    const rawCap = options.extra?.maxMetaAgentSize;
    const maxMetaAgentSize = rawCap === undefined ? MAX_META_AGENT_SIZE : rawCap;
    if (
      typeof maxMetaAgentSize !== "number" ||
      !Number.isInteger(maxMetaAgentSize) ||
      maxMetaAgentSize < 1 ||
      maxMetaAgentSize > MAX_META_AGENT_SIZE
    ) {
      return {
        variant,
        lowLevelWeight: 1,
        highLevelWeight: 1,
        optionError: `MA-CBS の extra.maxMetaAgentSize は 1〜${MAX_META_AGENT_SIZE} の整数にしてください。`,
      };
    }
    const optionWarnings: SolverWarning[] = [];
    if (options.suboptimalityFactor !== undefined) {
      optionWarnings.push({
        code: "option-ignored",
        message: "MA-CBS は最適解法のため suboptimalityFactor を使用しません。",
      });
    }
    return {
      variant,
      lowLevelWeight: 1,
      highLevelWeight: 1,
      mergeThreshold,
      maxMetaAgentSize,
      optionWarnings,
    };
  }

  if (
    variant === "cbs" ||
    variant === "icbs" ||
    variant === "cbsh" ||
    variant === "disjoint-splitting"
  ) {
    const optionWarnings: SolverWarning[] = [];
    if (options.suboptimalityFactor !== undefined) {
      optionWarnings.push({
        code: "option-ignored",
        message: `${variant.toUpperCase()} は最適解法のため suboptimalityFactor を使用しません。`,
      });
    }
    if (variant === "icbs") {
      optionWarnings.push({
        code: "simplified-behavior",
        message:
          "ブラウザ版 ICBS は PC+BP を実装し、MA-CBS merge と merge-and-restart は未対応です。",
      });
    }
    return { variant, lowLevelWeight: 1, highLevelWeight: 1, optionWarnings };
  }

  const requested = options.suboptimalityFactor ?? DEFAULT_BOUND;
  if (!validWeight(requested)) {
    return {
      variant,
      lowLevelWeight: 1,
      highLevelWeight: 1,
      optionError: "suboptimalityFactor は 1 以上の有限数で指定してください。",
    };
  }

  if (variant === "bcbs") {
    const rawHigh = options.extra?.highLevelWeight;
    const rawLow = options.extra?.lowLevelWeight;
    if ((rawHigh === undefined) !== (rawLow === undefined)) {
      return {
        variant,
        lowLevelWeight: 1,
        highLevelWeight: 1,
        optionError:
          "BCBS の extra.highLevelWeight と extra.lowLevelWeight は両方を指定してください。",
      };
    }
    if (rawHigh !== undefined && rawLow !== undefined) {
      if (!validWeight(rawHigh) || !validWeight(rawLow)) {
        return {
          variant,
          lowLevelWeight: 1,
          highLevelWeight: 1,
          optionError: "BCBS の highLevelWeight / lowLevelWeight は 1 以上の有限数にしてください。",
        };
      }
      const product = rawHigh * rawLow;
      if (
        options.suboptimalityFactor !== undefined &&
        Math.abs(product - options.suboptimalityFactor) > 1e-9
      ) {
        return {
          variant,
          lowLevelWeight: 1,
          highLevelWeight: 1,
          optionError:
            "BCBS では highLevelWeight * lowLevelWeight を suboptimalityFactor と一致させてください。",
        };
      }
      return {
        variant,
        lowLevelWeight: rawLow,
        highLevelWeight: rawHigh,
        requestedBound: product,
      };
    }
    const split = Math.sqrt(requested);
    return {
      variant,
      lowLevelWeight: split,
      highLevelWeight: split,
      requestedBound: requested,
    };
  }

  const optionWarnings: SolverWarning[] =
    variant === "eecbs"
      ? [
          {
            code: "simplified-behavior",
            message:
              "この EECBS は論文 §3 の基礎版です。§4 の relaxed bypass、PC、symmetry reasoning、WDG は使用しません。",
          },
        ]
      : [];
  return {
    variant,
    lowLevelWeight: requested,
    highLevelWeight: requested,
    requestedBound: requested,
    optionWarnings,
  };
}

function validWeight(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1;
}
