import type {
  AgentId,
  Cell,
  Constraint,
  SimulationRules,
  Time,
  TimedPath,
} from "@/lib/model/types.js";
import { positionAt } from "@/lib/model/conflicts.js";
import { cellEquals } from "@/lib/model/grid.js";

/**
 * CBS の正負制約を 1 頂点で検査する。
 *
 * positive constraint は対象 agent には必須条件、他 agent には暗黙の
 * collision-avoidance constraint になる。DS の正枝でこの含意を落とすと、
 * 元の conflict を持つ path がそのまま残り、同じ CT node を繰り返し得る。
 */
export function violatesConstraintsAtVertex(
  agentId: AgentId,
  cell: Cell,
  time: Time,
  constraints: readonly Constraint[],
  rules: SimulationRules,
): boolean {
  for (const constraint of constraints) {
    if (constraint.kind === "vertex") {
      if (constraint.agentId === agentId) {
        const same = cellEquals(constraint.cell, cell);
        if (constraint.time === time && (constraint.positive ? !same : same)) return true;
        continue;
      }
      if (
        constraint.positive &&
        cellEquals(constraint.cell, cell) &&
        positiveVertexBlocksOtherAt(constraint.time, time, rules)
      ) {
        return true;
      }
      continue;
    }

    if (!constraint.positive) continue;
    if (constraint.agentId === agentId) {
      // 離散 edge constraint の到着時刻は 1 以上でなければならない。
      if (constraint.time <= 0) return true;
      continue;
    }

    // ai が from@(t-1) -> to@t を必ず通るなら、他 agent はその 2 頂点を
    // 同時刻に占有できない。following 禁止時は、その直前・直後の占有も
    // owner または other が空けた跡へ入る conflict を必ず作る。
    if (
      (cellEquals(cell, constraint.from) &&
        positiveVertexBlocksOtherAt(constraint.time - 1, time, rules)) ||
      (cellEquals(cell, constraint.to) && positiveVertexBlocksOtherAt(constraint.time, time, rules))
    ) {
      return true;
    }
  }
  return false;
}

/** 到着時刻 time の遷移を正負 edge constraint と照合する。 */
export function violatesConstraintsOnTransition(
  agentId: AgentId,
  from: Cell,
  to: Cell,
  time: Time,
  constraints: readonly Constraint[],
  rules: SimulationRules,
): boolean {
  for (const constraint of constraints) {
    if (constraint.kind !== "edge" || constraint.time !== time) continue;

    if (constraint.agentId === agentId) {
      const sameEdge = cellEquals(constraint.from, from) && cellEquals(constraint.to, to);
      if (constraint.positive ? !sameEdge : sameEdge) return true;
      continue;
    }

    if (
      constraint.positive &&
      rules.forbidEdgeSwap &&
      cellEquals(constraint.to, from) &&
      cellEquals(constraint.from, to)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * from 以降を goal で wait した場合にも、将来の制約をすべて満たせるか。
 * positive edge が将来にある場合は、goal で早期終了して素通りしてはならない。
 */
export function canWaitAtGoalUnderConstraints(
  agentId: AgentId,
  goal: Cell,
  from: Time,
  constraints: readonly Constraint[],
  rules: SimulationRules,
): boolean {
  if (rules.goalBehavior === "disappear") return true;
  const lastRelevant = constraints.reduce(
    (latest, constraint) => Math.max(latest, constraint.time + (rules.forbidFollowing ? 1 : 0)),
    from,
  );
  for (let time = from + 1; time <= lastRelevant; time += 1) {
    if (violatesConstraintsAtVertex(agentId, goal, time, constraints, rules)) return false;
    if (violatesConstraintsOnTransition(agentId, goal, goal, time, constraints, rules))
      return false;
  }
  return true;
}

/** 現在 path が制約そのもの、または positive constraint の暗黙の禁止に違反するか。 */
export function pathViolatesConstraints(
  path: TimedPath,
  constraints: readonly Constraint[],
  rules: SimulationRules,
): boolean {
  const lastRelevant = constraints.reduce(
    (latest, constraint) => Math.max(latest, constraint.time + (rules.forbidFollowing ? 1 : 0)),
    0,
  );
  for (let time = 0; time <= lastRelevant; time += 1) {
    const cell = positionAt(path, time, rules);
    if (!cell) return true;
    if (violatesConstraintsAtVertex(path.agentId, cell, time, constraints, rules)) return true;
    if (time === 0) continue;
    const previous = positionAt(path, time - 1, rules);
    if (!previous) return true;
    if (violatesConstraintsOnTransition(path.agentId, previous, cell, time, constraints, rules)) {
      return true;
    }
  }
  return false;
}

function positiveVertexBlocksOtherAt(
  requiredTime: Time,
  otherTime: Time,
  rules: SimulationRules,
): boolean {
  if (requiredTime === otherTime) return true;
  return rules.forbidFollowing && Math.abs(requiredTime - otherTime) === 1;
}
