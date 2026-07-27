/// <reference lib="webworker" />
import type { SolverEvent } from "@/lib/model/types.js";
import { getSolver } from "./registry.js";
import { createSolverContext } from "./context.js";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol.js";

/**
 * Solver を UI スレッドの外で走らせる。
 *
 * ★ UI スレッドをブロックしないことが要件。
 *   重い探索はすべてここで動かし、結果とイベントだけを postMessage で返す。
 *
 * expand-node は大量に出るため、一定間隔でまとめて送る。
 * それでも溢れる場合は Worker 側で捨てる（可視化の精度より応答性を優先する）。
 */

const controllers = new Map<number, AbortController>();

/** 展開イベントの送信上限。これを超えた分は落とす。 */
const MAX_EXPAND_EVENTS = 4000;

function post(message: WorkerResponse): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
}

self.addEventListener("message", (raw: MessageEvent<WorkerRequest>) => {
  const message = raw.data;

  if (message.type === "abort") {
    controllers.get(message.requestId)?.abort();
    controllers.delete(message.requestId);
    return;
  }

  if (message.type !== "solve") return;

  const { requestId, solverId, scenario, options, seed } = message;
  const solver = getSolver(solverId);

  if (!solver) {
    post({
      type: "failed",
      requestId,
      error: {
        code: "not-implemented",
        message: `この手法の実装はまだありません: ${solverId}`,
      },
    });
    return;
  }

  const controller = new AbortController();
  controllers.set(requestId, controller);

  let expandCount = 0;
  let pending: SolverEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    flushTimer = null;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    for (const event of batch) post({ type: "event", requestId, event });
  };

  const emit = (event: SolverEvent) => {
    if (event.type === "expand-node") {
      expandCount += 1;
      // 序盤ほど密に、後半は間引く。全部送ると UI が追いつかない。
      if (expandCount > MAX_EXPAND_EVENTS) return;
      if (expandCount > 500 && expandCount % 5 !== 0) return;
    }
    pending.push(event);
    if (pending.length >= 64) {
      flush();
    } else if (flushTimer === null) {
      flushTimer = setTimeout(flush, 16);
    }
  };

  const context = createSolverContext({ seed, signal: controller.signal, emit });

  solver
    .solve(scenario, options, context)
    .then((result) => {
      if (flushTimer !== null) clearTimeout(flushTimer);
      flush();
      post({ type: "done", requestId, result });
    })
    .catch((err: unknown) => {
      if (flushTimer !== null) clearTimeout(flushTimer);
      flush();
      post({
        type: "failed",
        requestId,
        error: {
          code: "internal",
          message: err instanceof Error ? err.message : "不明なエラー",
          ...(err instanceof Error && err.stack ? { detail: err.stack } : {}),
        },
      });
    })
    .finally(() => {
      controllers.delete(requestId);
    });
});
