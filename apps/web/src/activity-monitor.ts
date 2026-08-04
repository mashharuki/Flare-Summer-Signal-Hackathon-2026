import type {
  ActivityEvent,
  ActivityEventKind,
  Address,
  AttestationRecord,
} from "@reserveflow/shared";

export type ActivityOutcome = "CONFIRMED" | "PAUSED" | "PENDING" | "REJECTED";

export interface ActivityFeedEntry {
  readonly details: Readonly<Record<string, string>>;
  readonly kind: ActivityEventKind;
  readonly occurredAt: bigint;
  readonly outcome: ActivityOutcome;
  readonly transactionHash?: ActivityEvent["txHash"];
  readonly verified: boolean;
}

export interface ActivityFeed {
  readonly entries: readonly ActivityFeedEntry[];
}

export interface MonitoringSummary {
  readonly attestationStatus: AttestationRecord["status"] | "NOT_REQUESTED";
  readonly isVerified: boolean;
  readonly lastSyncedAt: bigint;
  /** A snapshot is explicitly not a realtime claim. */
  readonly syncState: "SNAPSHOT";
}

export function buildActivityFeed(input: {
  readonly activities: readonly ActivityEvent[];
  readonly borrower: Address;
}): ActivityFeed {
  const borrower = input.borrower.toLowerCase();
  const entries = input.activities
    .filter((event) => event.details.borrower?.toLowerCase() === borrower)
    .toSorted((left, right) =>
      left.occurredAt === right.occurredAt
        ? 0
        : left.occurredAt > right.occurredAt
          ? -1
          : 1,
    )
    .map((event) => ({
      details: event.details,
      kind: event.kind,
      occurredAt: event.occurredAt,
      outcome: outcomeFor(event.kind),
      transactionHash: event.txHash,
      verified: isVerifiedEvent(event.kind),
    }));
  return { entries };
}

export function buildMonitoringSummary(input: {
  readonly attestation?: AttestationRecord;
  readonly lastSyncedAt: bigint;
}): MonitoringSummary {
  return {
    attestationStatus: input.attestation?.status ?? "NOT_REQUESTED",
    isVerified: input.attestation?.status === "VERIFIED",
    lastSyncedAt: input.lastSyncedAt,
    syncState: "SNAPSHOT",
  };
}

function isVerifiedEvent(kind: ActivityEventKind): boolean {
  return (
    kind === "RESERVE_UPDATED" ||
    kind === "PROOF_VERIFIED" ||
    kind === "BORROWED" ||
    kind === "REPAID"
  );
}

function outcomeFor(kind: ActivityEventKind): ActivityOutcome {
  if (kind === "PROOF_SUBMITTED") {
    return "PENDING";
  }
  if (kind === "PROOF_REJECTED") {
    return "REJECTED";
  }
  if (kind === "BORROWING_PAUSED") {
    return "PAUSED";
  }
  return "CONFIRMED";
}
