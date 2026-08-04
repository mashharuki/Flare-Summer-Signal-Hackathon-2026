import { describe, expect, it } from "vitest";

import { votingRoundForRequestBlock } from "./../../src/fdc/voting-round.js";

describe("votingRoundForRequestBlock", () => {
  it("calculates the FDC round from the request block timestamp", () => {
    expect(
      votingRoundForRequestBlock({
        blockTimestamp: 1_708_000_275n,
        firstVotingRoundStartTimestamp: 1_708_000_000n,
        votingEpochDurationSeconds: 90n,
      }),
    ).toBe(3n);
  });

  it("rejects an invalid Flare Systems Manager timing configuration", () => {
    expect(() =>
      votingRoundForRequestBlock({
        blockTimestamp: 100n,
        firstVotingRoundStartTimestamp: 100n,
        votingEpochDurationSeconds: 0n,
      }),
    ).toThrow("must be greater than zero");
  });
});
