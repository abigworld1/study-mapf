import type { Scenario, SolverEvent, SolverOptions, SolverResult } from "@/lib/model/types.js";
import { DEFAULT_SOLVER_OPTIONS } from "@/lib/model/types.js";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol.js";
import { getSolver } from "./registry.js";
import { createSolverContext } from "./context.js";

/**
 * UI スレッド側から Solver を呼ぶ入口。
 *
 * Worker を使えない環境（テスト、SSR、Worker 未対応ブラウザ）では
 * 同じ API のまま同期実行へフォールバックする。
 */
export interface RunSolverInput {
  readonly solverId: string;
  readonly scenario: Scenario;
  readonly options?: Partial<SolverOptions>;
  readonly seed?: number;
  readonly onEvent?: (event: SolverEvent) => void;
  readonly signal?: AbortSignal;
}

let worker: Worker | null = null;
let nextRequestId = 1;

function ensureWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    // Vite が base を解決する。パスを手で組み立てないこと。
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    return worker;
  } catch {
    return null;
  }
}

export async function runSolver(input: RunSolverInput): Promise<SolverResult> {
  const options: SolverOptions = { ...DEFAULT_SOLVER_OPTIONS, ...(input.options ?? {}) };
  const seed = input.seed ?? input.scenario.seed;

  const w = ensureWorker();
  if (!w) return runInline(input, options, seed);

  const requestId = nextRequestId++;

  return new Promise<SolverResult>((resolve, reject) => {
    const onAbort = () => {
      const abortMessage: WorkerRequest = { type: "abort", requestId };
      w.postMessage(abortMessage);
    };

    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      input.signal?.removeEventListener("abort", onAbort);
    };

    function onMessage(raw: MessageEvent<WorkerResponse>) {
      const message = raw.data;
      if (message.requestId !== requestId) return;

      if (message.type === "event") {
        input.onEvent?.(message.event);
        return;
      }
      if (message.type === "done") {
        cleanup();
        resolve(message.result);
        return;
      }
      cleanup();
      // 構造化されたエラーとして返す。例外を投げずに outcome で表現する。
      resolve({
        outcome: "error",
        paths: [],
        metrics: { sumOfCosts: 0, makespan: 0, runtimeMs: 0 },
        conflicts: [],
        error: {
          code: message.error.code === "not-implemented" ? "not-implemented" : "internal",
          message: message.error.message,
          ...(message.error.detail ? { detail: message.error.detail } : {}),
        },
      });
    }

    w.addEventListener("message", onMessage);
    input.signal?.addEventListener("abort", onAbort, { once: true });

    const request: WorkerRequest = {
      type: "solve",
      requestId,
      solverId: input.solverId,
      scenario: input.scenario,
      options,
      seed,
    };
    try {
      w.postMessage(request);
    } catch (err) {
      cleanup();
      reject(err instanceof Error ? err : new Error("Worker へ送信できませんでした"));
    }
  });
}

/** Worker が使えない場合。テストからも直接使う。 */
export async function runInline(
  input: RunSolverInput,
  options: SolverOptions = DEFAULT_SOLVER_OPTIONS,
  seed = input.scenario.seed,
): Promise<SolverResult> {
  const solver = getSolver(input.solverId);
  if (!solver) {
    return {
      outcome: "error",
      paths: [],
      metrics: { sumOfCosts: 0, makespan: 0, runtimeMs: 0 },
      conflicts: [],
      error: {
        code: "not-implemented",
        message: `この手法の実装はまだありません: ${input.solverId}`,
      },
    };
  }
  const controller = new AbortController();
  // ★ 既に abort 済みの signal を渡された場合、"abort" イベントは二度と発火しない。
  //   addEventListener だけだと中断が伝わらないため、現在の状態も見る。
  if (input.signal?.aborted) controller.abort();
  else input.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  const context = createSolverContext({
    seed,
    signal: controller.signal,
    emit: (e) => input.onEvent?.(e),
  });
  return solver.solve(input.scenario, options, context);
}

export function terminateSolverWorker(): void {
  worker?.terminate();
  worker = null;
}
