import type { Cell, GridMap } from "@/lib/model/types.js";
import { cellKey, manhattan, neighbors } from "@/lib/model/grid.js";
import type { LowLevelStopReason } from "./space-time-astar.js";

interface AbstractNode {
  readonly cell: Cell;
  readonly g: number;
  readonly f: number;
  readonly sequence: number;
}

export interface ReverseResumableAStarInput {
  readonly map: GridMap;
  /** 論文の O。RRA* 自身の Manhattan heuristic の向き先。 */
  readonly origin: Cell;
  /** 論文の G。逆向き探索の開始点。 */
  readonly goal: Cell;
  readonly maxExpansions: number;
  readonly consumeExpansion?: () => "ok" | LowLevelStopReason;
  readonly onExpand?: (cell: Cell, distanceFromGoal: number) => void;
}

/**
 * cooperative-pathfinding-2005 Algorithm 1, Reverse Resumable A*。
 *
 * goal から逆向きに探索し、distance(cell) が要求された時点で、その cell が
 * Closed に入るまで同じ OPEN / Closed を再開する。静的な 4 近傍 grid は辺が対称なので、
 * 得られる g は cell から goal までの真距離になる。
 */
export class ReverseResumableAStar {
  private readonly open: AbstractNode[];
  private readonly openBest = new Map<string, number>();
  private readonly closed = new Map<string, number>();
  private nextSequence = 1;
  private localExpanded = 0;
  private localGenerated = 0;
  private stopped: LowLevelStopReason | undefined;

  constructor(private readonly input: ReverseResumableAStarInput) {
    const node: AbstractNode = {
      cell: input.goal,
      g: 0,
      f: manhattan(input.goal, input.origin),
      sequence: 0,
    };
    this.open = [node];
    this.openBest.set(cellKey(input.goal), 0);
    this.localGenerated = 1;
  }

  get expanded(): number {
    return this.localExpanded;
  }

  get generated(): number {
    return this.localGenerated;
  }

  get reason(): LowLevelStopReason | undefined {
    return this.stopped;
  }

  /** 要求 cell から goal までの静的最短距離。到達不能または打ち切りなら Infinity。 */
  distance(cell: Cell): number {
    const key = cellKey(cell);
    const known = this.closed.get(key);
    if (known !== undefined) return known;
    if (this.stopped) return Number.POSITIVE_INFINITY;

    while (this.open.length > 0) {
      const index = this.findBestIndex();
      const current = this.open.splice(index, 1)[0]!;
      const currentKey = cellKey(current.cell);
      if (this.closed.has(currentKey) || this.openBest.get(currentKey) !== current.g) continue;

      const stop = this.consumeExpansion();
      if (stop !== "ok") {
        this.stopped = stop;
        return Number.POSITIVE_INFINITY;
      }
      this.localExpanded += 1;
      this.closed.set(currentKey, current.g);
      this.input.onExpand?.(current.cell, current.g);
      if (currentKey === key) return current.g;

      for (const next of neighbors(this.input.map, current.cell)) {
        const nextKey = cellKey(next);
        if (this.closed.has(nextKey)) continue;
        const g = current.g + 1;
        const previous = this.openBest.get(nextKey);
        if (previous !== undefined && previous <= g) continue;
        this.openBest.set(nextKey, g);
        this.open.push({
          cell: next,
          g,
          f: g + manhattan(next, this.input.origin),
          sequence: this.nextSequence,
        });
        this.nextSequence += 1;
        this.localGenerated += 1;
      }
    }

    return Number.POSITIVE_INFINITY;
  }

  private consumeExpansion(): "ok" | LowLevelStopReason {
    if (this.input.consumeExpansion) return this.input.consumeExpansion();
    return this.localExpanded >= this.input.maxExpansions ? "max-expansions" : "ok";
  }

  private findBestIndex(): number {
    let bestIndex = 0;
    for (let index = 1; index < this.open.length; index += 1) {
      const candidate = this.open[index]!;
      const best = this.open[bestIndex]!;
      if (
        candidate.f < best.f ||
        (candidate.f === best.f && candidate.g > best.g) ||
        (candidate.f === best.f && candidate.g === best.g && candidate.cell.y < best.cell.y) ||
        (candidate.f === best.f &&
          candidate.g === best.g &&
          candidate.cell.y === best.cell.y &&
          candidate.cell.x < best.cell.x) ||
        (candidate.f === best.f &&
          candidate.g === best.g &&
          candidate.cell.y === best.cell.y &&
          candidate.cell.x === best.cell.x &&
          candidate.sequence < best.sequence)
      ) {
        bestIndex = index;
      }
    }
    return bestIndex;
  }
}
