import type { Scenario, SolverEvent, SolverOptions, SolverResult } from "@/lib/model/types.js";

/** UI スレッド → Worker */
export type WorkerRequest =
  | {
      readonly type: "solve";
      readonly requestId: number;
      readonly solverId: string;
      readonly scenario: Scenario;
      readonly options: SolverOptions;
      readonly seed: number;
    }
  | { readonly type: "abort"; readonly requestId: number };

/** Worker → UI スレッド */
export type WorkerResponse =
  | { readonly type: "event"; readonly requestId: number; readonly event: SolverEvent }
  | { readonly type: "done"; readonly requestId: number; readonly result: SolverResult }
  | {
      readonly type: "failed";
      readonly requestId: number;
      readonly error: { code: string; message: string; detail?: string };
    };

/**
 * イベントを間引く閾値。
 * expand-node は数万件出るので、そのまま postMessage すると UI が固まる。
 * Worker 側でまとめて送る。
 */
export const EVENT_BATCH_SIZE = 200;
