import {
  type ActivityEvent,
  type AttestationRecord,
  asAccountId,
  asAddress,
  asProofId,
  asTransactionHash,
} from "@reserveflow/shared";
import { describe, expect, it } from "vitest";

import {
  buildActivityFeed,
  buildMonitoringSummary,
} from "./../src/activity-monitor.js";

const BORROWER = asAddress("0x1111111111111111111111111111111111111111");
const OTHER_BORROWER = asAddress("0x2222222222222222222222222222222222222222");
const TX_HASH = asTransactionHash(
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
);

function event(
  kind: ActivityEvent["kind"],
  occurredAt: bigint,
  borrower: string,
): ActivityEvent {
  return {
    details: { borrower },
    kind,
    occurredAt,
    txHash: TX_HASH,
  };
}

function attestation(status: AttestationRecord["status"]): AttestationRecord {
  return {
    accountId: asAccountId(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ),
    createdAt: 1n,
    id: asProofId(
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ),
    requestBytesHash: asProofId(
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ),
    status,
    txHash: TX_HASH,
    updatedAt: 2n,
  };
}

describe("activity monitor", () => {
  it("shows only the connected borrower's events in newest-first order", () => {
    const activities = [
      event("REPAID", 10n, BORROWER),
      event("BORROWED", 30n, BORROWER.toUpperCase()),
      event("RESERVE_UPDATED", 40n, OTHER_BORROWER),
      event("PROOF_SUBMITTED", 20n, BORROWER),
    ];

    const feed = buildActivityFeed({ activities, borrower: BORROWER });

    expect(feed.entries.map((entry) => entry.kind)).toEqual([
      "BORROWED",
      "PROOF_SUBMITTED",
      "REPAID",
    ]);
    expect(activities[0]?.kind).toBe("REPAID");
  });

  it("distinguishes pending proof activity from a verified reserve update", () => {
    const feed = buildActivityFeed({
      activities: [
        event("PROOF_SUBMITTED", 20n, BORROWER),
        event("RESERVE_UPDATED", 10n, BORROWER),
      ],
      borrower: BORROWER,
    });

    expect(feed.entries[0]).toMatchObject({
      outcome: "PENDING",
      verified: false,
    });
    expect(feed.entries[1]).toMatchObject({
      outcome: "CONFIRMED",
      verified: true,
    });
  });

  it("surfaces rejected proofs and emergency pauses as non-success outcomes", () => {
    const feed = buildActivityFeed({
      activities: [
        event("PROOF_REJECTED", 20n, BORROWER),
        event("BORROWING_PAUSED", 10n, BORROWER),
      ],
      borrower: BORROWER,
    });

    expect(feed.entries.map((entry) => entry.outcome)).toEqual([
      "REJECTED",
      "PAUSED",
    ]);
    expect(feed.entries.every((entry) => !entry.verified)).toBe(true);
  });

  it("never labels a coordinator proof as verified before the core event", () => {
    expect(
      buildMonitoringSummary({
        attestation: attestation("PROOF_READY"),
        lastSyncedAt: 100n,
      }),
    ).toEqual({
      attestationStatus: "PROOF_READY",
      isVerified: false,
      lastSyncedAt: 100n,
      syncState: "SNAPSHOT",
    });
    expect(
      buildMonitoringSummary({
        attestation: attestation("VERIFIED"),
        lastSyncedAt: 101n,
      }).isVerified,
    ).toBe(true);
  });
});
