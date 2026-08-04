import {
  type ActivityEvent,
  type AttestationRecord,
  asAccountId,
  asAddress,
  asBasisPoints,
  asProofId,
  asTransactionHash,
  asWad,
  type CreditPosition,
  type RiskSnapshot,
} from "@reserveflow/shared";
import { describe, expect, it, vi } from "vitest";

import { buildActivityFeed } from "../src/activity-monitor.js";
import {
  connectCoston2Wallet,
  createAppShellView,
  WebAppError,
} from "../src/app-shell.js";
import {
  buildReserveAttestationTimeline,
  validateXrplTestnetAddress,
} from "../src/attestation-timeline.js";
import {
  buildBorrowPreview,
  buildCreditDashboard,
  buildRepaymentPreview,
} from "../src/credit-experience.js";

const ACCOUNT_ID = asAccountId(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const BORROWER = asAddress("0x1111111111111111111111111111111111111111");
const TX_HASH = asTransactionHash(
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
);
const PROOF_ID = asProofId(
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
);
const POSITION: CreditPosition = {
  borrower: BORROWER,
  lastRiskSyncAt: 1_723_000_000n,
  openedAt: 1_722_000_000n,
  principalWad: asWad(30_000_000_000_000_000_000n),
  reserveAccountId: ACCOUNT_ID,
  status: "HEALTHY",
};

function record(status: AttestationRecord["status"]): AttestationRecord {
  return {
    accountId: ACCOUNT_ID,
    createdAt: 1n,
    id: PROOF_ID,
    requestBytesHash: PROOF_ID,
    status,
    txHash: TX_HASH,
    updatedAt: 2n,
  };
}

function risk(status: RiskSnapshot["status"]): RiskSnapshot {
  return {
    adjustedReserveUsdWad: asWad(140_000_000_000_000_000_000n),
    availableCreditWad: asWad(40_000_000_000_000_000_000n),
    creditLimitWad: asWad(70_000_000_000_000_000_000n),
    grossReserveUsdWad: asWad(200_000_000_000_000_000_000n),
    healthFactorBps: asBasisPoints(23_333n),
    priceTimestamp: 1_723_000_000n,
    reserveTimestamp: 1_722_999_900n,
    status,
  };
}

function event(kind: ActivityEvent["kind"], occurredAt: bigint): ActivityEvent {
  return {
    details: { borrower: BORROWER },
    kind,
    occurredAt,
    txHash: TX_HASH,
  };
}

describe("Coston2 test-asset borrower journey", () => {
  it("covers reserve registration, FDC wait, proof reflection, borrow, outflow risk, pause, approval, and repayment", async () => {
    const shell = createAppShellView({
      configured: true,
      connection: { status: "DISCONNECTED" },
    });
    expect(shell.supportedReserve).toEqual({
      asset: "XRP",
      network: "XRPL Testnet",
    });
    expect(shell.disclosure).toContain("本番融資ではありません");

    const provider = {
      request: vi
        .fn()
        .mockResolvedValueOnce([BORROWER])
        .mockResolvedValueOnce("0x72"),
    };
    await expect(connectCoston2Wallet(provider)).resolves.toMatchObject({
      account: BORROWER,
      chainId: 114,
    });
    expect(
      validateXrplTestnetAddress(
        "rELiPixQHM5NLgMqXovBmwZCYw6tFKZxh8",
        () => true,
      ),
    ).toBe("rELiPixQHM5NLgMqXovBmwZCYw6tFKZxh8");

    expect(
      buildReserveAttestationTimeline({ record: record("SUBMITTED") }),
    ).toMatchObject({
      nextAction: { kind: "WAIT" },
      reserveUpdated: false,
    });
    expect(
      buildReserveAttestationTimeline({ record: record("PROOF_READY") }),
    ).toMatchObject({
      nextAction: { kind: "SUBMIT_TO_CORE" },
      reserveUpdated: false,
    });
    expect(
      buildReserveAttestationTimeline({ record: record("VERIFIED") }),
    ).toMatchObject({ reserveUpdated: true });

    expect(
      buildCreditDashboard({ position: POSITION, risk: risk("HEALTHY") }).risk
        .borrowingEnabled,
    ).toBe(true);
    expect(
      buildBorrowPreview({
        amountWad: asWad(10_000_000_000_000_000_000n),
        position: POSITION,
        risk: risk("HEALTHY"),
      }).allowed,
    ).toBe(true);

    const outgoingProofRisk = buildBorrowPreview({
      amountWad: asWad(1_000_000_000_000_000_000n),
      position: { ...POSITION, status: "MARGIN_CALL" },
      risk: risk("MARGIN_CALL"),
    });
    expect(outgoingProofRisk.blockingReason?.code).toBe("CREDIT_NOT_HEALTHY");
    expect(
      buildBorrowPreview({
        amountWad: asWad(1_000_000_000_000_000_000n),
        borrowingPaused: true,
        position: POSITION,
        risk: risk("HEALTHY"),
      }).blockingReason?.code,
    ).toBe("BORROWING_PAUSED");

    const approval = buildRepaymentPreview({
      allowanceWad: asWad(0n),
      amountWad: asWad(10_000_000_000_000_000_000n),
      balanceWad: asWad(10_000_000_000_000_000_000n),
      position: { ...POSITION, status: "FROZEN" },
      risk: risk("FROZEN"),
    });
    expect(approval.action).toBe("APPROVE");
    const repayment = buildRepaymentPreview({
      allowanceWad: asWad(10_000_000_000_000_000_000n),
      amountWad: asWad(10_000_000_000_000_000_000n),
      balanceWad: asWad(10_000_000_000_000_000_000n),
      position: { ...POSITION, status: "FROZEN" },
      risk: risk("FROZEN"),
    });
    expect(repayment).toMatchObject({
      action: "REPAY",
      principalWad: 20_000_000_000_000_000_000n,
    });

    expect(
      buildActivityFeed({
        activities: [
          event("RESERVE_REGISTERED", 1n),
          event("PROOF_SUBMITTED", 2n),
          event("RESERVE_UPDATED", 3n),
          event("BORROWED", 4n),
          event("BORROWING_PAUSED", 5n),
          event("REPAID", 6n),
        ],
        borrower: BORROWER,
      }).entries.map((entry) => entry.kind),
    ).toEqual([
      "REPAID",
      "BORROWING_PAUSED",
      "BORROWED",
      "RESERVE_UPDATED",
      "PROOF_SUBMITTED",
      "RESERVE_REGISTERED",
    ]);
  });

  it("keeps unsafe network, address, stale data, warning, and margin-call paths recoverable", async () => {
    await expect(
      connectCoston2Wallet({
        request: vi
          .fn()
          .mockResolvedValueOnce([BORROWER])
          .mockResolvedValueOnce("0x1"),
      }),
    ).rejects.toEqual(
      new WebAppError(
        "WRONG_NETWORK",
        "Coston2（chain ID 114）へ切り替えてから再試行してください。",
      ),
    );
    expect(() => validateXrplTestnetAddress("invalid", () => false)).toThrow(
      "XRPL Testnetの有効なclassic address",
    );

    const cases: Array<[RiskSnapshot["status"], string]> = [
      ["PRICE_STALE", "STALE_PRICE"],
      ["RESERVE_STALE", "STALE_RESERVE"],
      ["WARNING", "CREDIT_NOT_HEALTHY"],
      ["MARGIN_CALL", "CREDIT_NOT_HEALTHY"],
    ];
    for (const [status, code] of cases) {
      expect(
        buildBorrowPreview({
          amountWad: asWad(1_000_000_000_000_000_000n),
          position: { ...POSITION, status },
          risk: risk(status),
        }).blockingReason?.code,
      ).toBe(code);
    }
  });
});
