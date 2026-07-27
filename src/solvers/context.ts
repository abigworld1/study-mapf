import type {
  SolverContext,
  SolverEvent,
  SolverOptions,
  SolverWarning,
} from "@/lib/model/types.js";
import { createRandom } from "@/lib/model/random.js";
import { shouldRecord } from "./limits.js";

export interface CreateContextInput {
  readonly seed: number;
  readonly signal: AbortSignal;
  readonly emit: (event: SolverEvent) => void;
  /** テストから差し替えられるようにしている。既定は performance.now。 */
  readonly now?: () => number;
}

/**
 * SolverContext を作る。
 *
 * ★ Solver 内で Math.random() / Date.now() を直接使わないこと。
 *   context.random() / context.now() を通すことで、
 *   「同じ seed と同じ入力なら同じ結果」が保てる。
 */
export function createSolverContext(input: CreateContextInput): SolverContext {
  const random = createRandom(input.seed);
  const now =
    input.now ?? (typeof performance !== "undefined" ? () => performance.now() : () => Date.now());
  return {
    signal: input.signal,
    emit: input.emit,
    random,
    now,
  };
}

/** イベントを配列に貯めるだけの context。テストで使う。 */
export function createRecordingContext(
  seed = 1,
  signal: AbortSignal = new AbortController().signal,
): { context: SolverContext; events: SolverEvent[] } {
  const events: SolverEvent[] = [];
  let clock = 0;
  const context = createSolverContext({
    seed,
    signal,
    emit: (e) => events.push(e),
    now: () => {
      clock += 1;
      return clock;
    },
  });
  return { context, events };
}

/**
 * SolverResult.trace のためのイベント記録器。
 *
 * ★ 詳細度と件数の上限を守る。上限に達したら以降は捨て、打ち切りを報告する。
 *   全部貯めると数十万件になり、Worker から UI へ返す時点で固まる。
 *
 * 使い方（Solver 内）:
 *   const recorder = createTraceRecorder(options);
 *   const emit = (e: SolverEvent) => { recorder.record(e); context.emit(e); };
 *   ...
 *   return { ...result, trace: recorder.events, warnings: recorder.warnings };
 */
export interface TraceRecorder {
  record(event: SolverEvent): void;
  readonly events: readonly SolverEvent[];
  readonly truncated: boolean;
  readonly warnings: readonly SolverWarning[];
}

export function createTraceRecorder(options: SolverOptions): TraceRecorder {
  const events: SolverEvent[] = [];
  let truncated = false;

  return {
    record(event) {
      if (!shouldRecord(event.type, options.traceLevel)) return;
      if (events.length >= options.maxTraceEvents) {
        truncated = true;
        return;
      }
      events.push(event);
    },
    get events() {
      return events;
    },
    get truncated() {
      return truncated;
    },
    get warnings(): readonly SolverWarning[] {
      return truncated
        ? [
            {
              code: "trace-truncated" as const,
              message: `トレースが上限 ${options.maxTraceEvents} 件に達したため打ち切りました。詳細度を下げるか上限を上げてください。`,
            },
          ]
        : [];
    },
  };
}
