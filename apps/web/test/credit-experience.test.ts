import {
  asAccountId,
  asAddress,
  asBasisPoints,
  asWad,
  type CreditPosition,
  type RiskSnapshot,
} from "@reserveflow/shared";
import { describe, expect, it } from "vitest";

import {
  buildBorrowPreview,
  buildCreditDashboard,
  buildPriceDropPreview,
  buildRepaymentPreview,
  formatHealthFactor,
  formatRfUsd,
  formatUsd,
  parseRfUsd,
} from "./../src/credit-experience.js";

const POSITION: CreditPosition = {
  borrower: asAddress("0x1111111111111111111111111111111111111111"),
  lastRiskSyncAt: 1_723_000_000n,
  openedAt: 1_722_000_000n,
  principalWad: asWad(30_000_000_000_000_000_000n),
  reserveAccountId: asAccountId(
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ),
  status: "HEALTHY",
};

function snapshot(status: RiskSnapshot["status"] = "HEALTHY"): RiskSnapshot {
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

describe("credit dashboard", () => {
  it("renders every credit metric from one risk snapshot and makes data freshness explicit", () => {
    const dashboard = buildCreditDashboard({
      position: POSITION,
      risk: snapshot(),
    });

    expect(dashboard.metrics).toMatchObject({
      adjustedReserveUsdWad: 140_000_000_000_000_000_000n,
      availableCreditWad: 40_000_000_000_000_000_000n,
      creditLimitWad: 70_000_000_000_000_000_000n,
      grossReserveUsdWad: 200_000_000_000_000_000_000n,
      haircutBps: 3_000n,
      healthFactorBps: 23_333n,
      maxLtvBps: 5_000n,
      principalWad: 30_000_000_000_000_000_000n,
    });
    expect(dashboard.freshness).toEqual({
      priceTimestamp: 1_723_000_000n,
      reserveTimestamp: 1_722_999_900n,
    });
    expect(dashboard.risk.borrowingEnabled).toBe(true);
  });

  it("explains stale, warning, margin-call, and frozen states with a recovery action", () => {
    const cases: Array<[RiskSnapshot["status"], string]> = [
      ["PRICE_STALE", "価格データの更新を待ってから"],
      ["RESERVE_STALE", "新しい準備金証明を完了してから"],
      ["WARNING", "返済または準備金の更新"],
      ["MARGIN_CALL", "返済または担保リスクの低減"],
      ["FROZEN", "返済は継続できます"],
    ];

    for (const [status, recovery] of cases) {
      const dashboard = buildCreditDashboard({
        position: { ...POSITION, status },
        risk: snapshot(status),
      });

      expect(dashboard.risk.borrowingEnabled).toBe(false);
      expect(dashboard.risk.recovery).toContain(recovery);
    }
  });

  it("shows a read-only price-drop projection from the simulated snapshot", () => {
    const preview = buildPriceDropPreview({
      dropBps: asBasisPoints(2_500n),
      simulatedRisk: {
        ...snapshot("WARNING"),
        availableCreditWad: asWad(5_000_000_000_000_000_000n),
        creditLimitWad: asWad(35_000_000_000_000_000_000n),
        healthFactorBps: asBasisPoints(11_666n),
      },
    });

    expect(preview).toMatchObject({
      creditLimitWad: 35_000_000_000_000_000_000n,
      dropBps: 2_500n,
      healthFactorBps: 11_666n,
      isReadOnly: true,
      status: "WARNING",
    });
  });
});

describe("borrow and repayment experience", () => {
  it("previews post-borrow debt, available credit, and health before a healthy request", () => {
    const preview = buildBorrowPreview({
      amountWad: asWad(10_000_000_000_000_000_000n),
      position: POSITION,
      risk: snapshot(),
    });

    expect(preview).toMatchObject({
      allowed: true,
      availableCreditWad: 30_000_000_000_000_000_000n,
      principalWad: 40_000_000_000_000_000_000n,
    });
    expect(preview.healthFactorBps).toBe(17_500n);
  });

  it("blocks over-limit and stale borrow requests with actionable contract error copy", () => {
    const overLimit = buildBorrowPreview({
      amountWad: asWad(41_000_000_000_000_000_000n),
      position: POSITION,
      risk: snapshot(),
    });
    const stale = buildBorrowPreview({
      amountWad: asWad(1_000_000_000_000_000_000n),
      position: POSITION,
      risk: snapshot("PRICE_STALE"),
    });

    expect(overLimit.blockingReason?.code).toBe("CREDIT_LIMIT_EXCEEDED");
    expect(stale.blockingReason).toMatchObject({
      code: "STALE_PRICE",
      recovery: "少し待ってからもう一度お試しください。",
    });
  });

  it("requires approval before repayment when allowance is insufficient, while allowing repayment in a frozen state", () => {
    const preview = buildRepaymentPreview({
      amountWad: asWad(10_000_000_000_000_000_000n),
      allowanceWad: asWad(0n),
      balanceWad: asWad(10_000_000_000_000_000_000n),
      position: { ...POSITION, status: "FROZEN" },
      risk: snapshot("FROZEN"),
    });

    expect(preview).toMatchObject({
      action: "APPROVE",
      availableCreditWad: 50_000_000_000_000_000_000n,
      principalWad: 20_000_000_000_000_000_000n,
    });
  });

  it("rejects a repayment above principal without producing a state preview", () => {
    const preview = buildRepaymentPreview({
      amountWad: asWad(31_000_000_000_000_000_000n),
      allowanceWad: asWad(31_000_000_000_000_000_000n),
      balanceWad: asWad(31_000_000_000_000_000_000n),
      position: POSITION,
      risk: snapshot(),
    });

    expect(preview).toEqual({
      action: "BLOCKED",
      blockingReason: expect.objectContaining({ code: "EXCESS_REPAYMENT" }),
    });
  });
});

describe("dashboard formatting", () => {
  it("formats fixed-point money and infinite health without floating point", () => {
    expect(formatRfUsd(asWad(12_345_000_000_000_000_000n))).toBe(
      "12.345 rfUSD",
    );
    expect(formatUsd(asWad(12_345_000_000_000_000_000n))).toBe("$12.345");
    expect(formatHealthFactor("INFINITE")).toBe("∞");
    expect(formatHealthFactor(asBasisPoints(12_345n))).toBe("123.45%");
  });

  it("parses a user-entered rfUSD amount without accepting imprecise decimal input", () => {
    expect(parseRfUsd("12.345")).toBe(12_345_000_000_000_000_000n);
    expect(parseRfUsd("12.3456")).toBeUndefined();
    expect(parseRfUsd("-1")).toBeUndefined();
  });
});
