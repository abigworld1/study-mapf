/** Deterministic deferred-acceptance (Gale--Shapley) implementation. */

export interface StableMatching {
  /** proposer index -> receiver index, or null if unmatched */
  readonly proposerToReceiver: readonly (number | null)[];
  /** receiver index -> proposer index, or null if unmatched */
  readonly receiverToProposer: readonly (number | null)[];
}

export function galeShapley(
  proposerPreferences: readonly (readonly number[])[],
  receiverPreferences: readonly (readonly number[])[],
): StableMatching {
  const receiverRank = receiverPreferences.map((preferences) => {
    const rank = new Map<number, number>();
    preferences.forEach((proposer, index) => rank.set(proposer, index));
    return rank;
  });
  const proposerToReceiver: (number | null)[] = Array.from(
    { length: proposerPreferences.length },
    () => null,
  );
  const receiverToProposer: (number | null)[] = Array.from(
    { length: receiverPreferences.length },
    () => null,
  );
  const next = new Array<number>(proposerPreferences.length).fill(0);
  const free: number[] = proposerPreferences.map((_, index) => index);

  while (free.length > 0) {
    const proposer = free.shift()!;
    const preferences = proposerPreferences[proposer] ?? [];
    if (next[proposer]! >= preferences.length) continue;
    const receiver = preferences[next[proposer]!]!;
    next[proposer] = next[proposer]! + 1;
    if (receiver < 0 || receiver >= receiverPreferences.length) {
      free.push(proposer);
      continue;
    }
    const current = receiverToProposer[receiver] ?? null;
    const rank = receiverRank[receiver]?.get(proposer) ?? Number.POSITIVE_INFINITY;
    const currentRank =
      current === null
        ? Number.POSITIVE_INFINITY
        : (receiverRank[receiver]?.get(current) ?? Number.POSITIVE_INFINITY);
    if (current === null || rank < currentRank || (rank === currentRank && proposer < current)) {
      if (current !== null) {
        proposerToReceiver[current] = null;
        free.push(current);
      }
      receiverToProposer[receiver] = proposer;
      proposerToReceiver[proposer] = receiver;
    } else {
      free.push(proposer);
    }
  }

  return { proposerToReceiver, receiverToProposer };
}

export function hasBlockingPair(
  matching: StableMatching,
  proposerPreferences: readonly (readonly number[])[],
  receiverPreferences: readonly (readonly number[])[],
): boolean {
  const receiverRank = receiverPreferences.map((preferences) => {
    const rank = new Map<number, number>();
    preferences.forEach((proposer, index) => rank.set(proposer, index));
    return rank;
  });
  for (let proposer = 0; proposer < proposerPreferences.length; proposer += 1) {
    const currentReceiver = matching.proposerToReceiver[proposer];
    const currentRank =
      currentReceiver === null || currentReceiver === undefined
        ? Number.POSITIVE_INFINITY
        : (receiverRank[currentReceiver]?.get(proposer) ?? Number.POSITIVE_INFINITY);
    for (const receiver of proposerPreferences[proposer] ?? []) {
      if (receiver === currentReceiver) break;
      const held = matching.receiverToProposer[receiver];
      const heldRank =
        held === null || held === undefined
          ? Number.POSITIVE_INFINITY
          : (receiverRank[receiver]?.get(held) ?? Number.POSITIVE_INFINITY);
      if (currentRank > heldRank) return true;
    }
  }
  return false;
}
