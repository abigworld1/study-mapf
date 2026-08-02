import type { Cell, GridMap, TeamSpec, Time, TimedPath } from "@/lib/model/types.js";
import { cellEquals, isWalkable, movesWithWait } from "@/lib/model/grid.js";
import { MinCostMaxFlow } from "@/lib/flow/min-cost-max-flow.js";

export interface TeamFlowConstraint {
  readonly kind: "vertex" | "edge";
  readonly cell?: Cell;
  readonly from?: Cell;
  readonly to?: Cell;
  readonly time: Time;
}

export interface TeamFlowResult {
  readonly paths: readonly TimedPath[];
  readonly cost: number;
}

interface Transition {
  readonly from: Cell;
  readonly to: Cell;
  readonly time: Time;
  readonly tag: string;
}

/**
 * Anonymous team planning on a time-expanded network.  The network is a
 * single commodity flow: starts supply one unit and targets consume one unit.
 * Flow paths are made agent-specific only after the integral flow is found.
 */
export function solveTeamByMinCostFlow(
  map: GridMap,
  team: TeamSpec,
  starts: readonly Cell[],
  horizon: number,
  constraints: readonly TeamFlowConstraint[],
): TeamFlowResult | null {
  const cells: Cell[] = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const cell = { x, y };
      if (isWalkable(map, cell)) cells.push(cell);
    }
  }
  const nodeCount = 2 + cells.length * (horizon + 1) * 2;
  const source = nodeCount - 2;
  const sink = nodeCount - 1;
  const flow = new MinCostMaxFlow(nodeCount);
  const cellIndex = new Map(cells.map((cell, index) => [`${cell.x},${cell.y}`, index]));
  const inNode = (cell: Cell, time: Time) =>
    (cellIndex.get(`${cell.x},${cell.y}`) ?? -1) * 2 * (horizon + 1) + time * 2;
  const outNode = (cell: Cell, time: Time) => inNode(cell, time) + 1;
  const blockedVertex = (cell: Cell, time: Time) =>
    constraints.some(
      (constraint) =>
        constraint.kind === "vertex" &&
        constraint.time === time &&
        constraint.cell !== undefined &&
        cellEquals(constraint.cell, cell),
    );
  const blockedEdge = (from: Cell, to: Cell, time: Time) =>
    constraints.some(
      (constraint) =>
        constraint.kind === "edge" &&
        constraint.time === time &&
        constraint.from !== undefined &&
        constraint.to !== undefined &&
        cellEquals(constraint.from, from) &&
        cellEquals(constraint.to, to),
    );

  for (const cell of cells) {
    for (let time = 0; time <= horizon; time += 1) {
      if (!blockedVertex(cell, time)) flow.addEdge(inNode(cell, time), outNode(cell, time), 1, 0);
    }
  }
  for (const [index, agentId] of team.agentIds.entries()) {
    const start = starts[index];
    if (!start || blockedVertex(start, 0)) return null;
    flow.addEdge(source, inNode(start, 0), 1, 0, `start:${agentId}`);
  }
  for (const [goalIndex, goal] of team.goals.entries()) {
    if (blockedVertex(goal, horizon)) return null;
    flow.addEdge(inNode(goal, horizon), sink, 1, 0, `goal:${goalIndex}`);
  }

  const transitions: Transition[] = [];
  for (const cell of cells) {
    for (let time = 0; time < horizon; time += 1) {
      for (const next of movesWithWait(map, cell, { allowDiagonal: false })) {
        if (blockedVertex(next, time + 1) || blockedEdge(cell, next, time + 1)) continue;
        const tag = `move:${cell.x},${cell.y},${time}>${next.x},${next.y}`;
        transitions.push({ from: cell, to: next, time: time + 1, tag });
        flow.addEdge(
          outNode(cell, time),
          inNode(next, time + 1),
          1,
          cellEquals(cell, next) ? 0 : 1,
          tag,
        );
      }
    }
  }
  const result = flow.solve(source, sink, team.agentIds.length);
  if (result.flow !== team.agentIds.length) return null;
  const used = new Map<string, number>();
  for (const edge of flow.usedTaggedEdges()) used.set(edge.tag, edge.flow);

  const paths: TimedPath[] = [];
  for (const [index, agentId] of team.agentIds.entries()) {
    const start = starts[index];
    if (!start) return null;
    const positions = [{ time: 0, cell: start }];
    let current = start;
    for (let time = 1; time <= horizon; time += 1) {
      const candidate = transitions.find(
        (transition) =>
          transition.time === time &&
          cellEquals(transition.from, current) &&
          (used.get(transition.tag) ?? 0) > 0,
      );
      if (!candidate) return null;
      used.set(candidate.tag, (used.get(candidate.tag) ?? 0) - 1);
      current = candidate.to;
      positions.push({ time, cell: current });
    }
    paths.push({ agentId, positions });
  }
  return { paths, cost: paths.reduce((sum, path) => sum + moveCost(path), 0) };
}

function moveCost(path: TimedPath): number {
  let cost = 0;
  for (let index = 1; index < path.positions.length; index += 1) {
    if (!cellEquals(path.positions[index - 1]!.cell, path.positions[index]!.cell)) cost += 1;
  }
  return cost;
}
