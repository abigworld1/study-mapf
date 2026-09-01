import type { AgentId, Constraint } from "@/lib/model/types.js";

/** MA-CBS の 1 回の高レベル分岐で加えた meta-constraint。 */
export interface MetaConstraintRecord {
  /** subject meta-agent の各構成員へ複製した同一時空間の制約。 */
  readonly constraints: readonly Constraint[];
  readonly subjectAgentIds: readonly AgentId[];
  readonly opponentAgentIds: readonly AgentId[];
}

/**
 * group を結合低レベルで再計画するときに残す外部制約だけを返す。
 *
 * subject と opponent の全員が同じ group に入った record は、結合探索自身が
 * 内部衝突を禁止するため捨てる。それ以外は、制約を課された元の agent にだけ
 * 引き継ぐ（ma-cbs-socs-2012 PDF p.5 の meta-constraint の扱い）。
 */
export function activeConstraintsForGroup(
  records: readonly MetaConstraintRecord[],
  group: readonly AgentId[],
): Constraint[] {
  const members = new Set(group);
  const active: Constraint[] = [];
  for (const record of records) {
    const internal = [...record.subjectAgentIds, ...record.opponentAgentIds].every((agentId) =>
      members.has(agentId),
    );
    if (internal) continue;
    for (const constraint of record.constraints) {
      if (members.has(constraint.agentId)) active.push(constraint);
    }
  }
  return active;
}
