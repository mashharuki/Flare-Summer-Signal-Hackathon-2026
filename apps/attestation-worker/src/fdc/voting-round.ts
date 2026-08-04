export function votingRoundForRequestBlock(input: {
  readonly blockTimestamp: bigint;
  readonly firstVotingRoundStartTimestamp: bigint;
  readonly votingEpochDurationSeconds: bigint;
}): bigint {
  if (input.votingEpochDurationSeconds <= 0n) {
    throw new Error(
      "Flare Systems Manager voting epoch duration must be greater than zero.",
    );
  }
  if (input.blockTimestamp < input.firstVotingRoundStartTimestamp) {
    throw new Error(
      "FDC request block predates the first voting round start timestamp.",
    );
  }
  return (
    (input.blockTimestamp - input.firstVotingRoundStartTimestamp) /
    input.votingEpochDurationSeconds
  );
}
