import { describe, expect, it } from "vitest";

import {
  asAccountId,
  asAddress,
  asBasisPoints,
  asDrops,
  asWad,
  type CreditPosition,
  dropsToWad,
  type RiskSnapshot,
  toUserFacingError,
  wadToDropsFloor,
} from "../src/domain.js";

describe("ReserveFlow domain contracts", () => {
  it("converts XRP drops to WAD and back without floating-point arithmetic", () => {
    const drops = asDrops(1_500_000n);

    expect(dropsToWad(drops)).toBe(1_500_000_000_000_000_000n);
    expect(wadToDropsFloor(asWad(1_500_000_999_999_999_999n))).toBe(drops);
  });

  it("rejects negative amounts and basis points", () => {
    expect(() => asDrops(-1n)).toThrow("non-negative");
    expect(() => asBasisPoints(-1n)).toThrow("non-negative");
  });

  it("validates EVM addresses before they cross a system boundary", () => {
    expect(asAddress("0x1111111111111111111111111111111111111111")).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(() => asAddress("xrpl-address")).toThrow("20-byte EVM address");
  });

  it("maps domain errors to actionable user-safe messages", () => {
    expect(toUserFacingError("STALE_PRICE")).toEqual({
      code: "STALE_PRICE",
      title: "価格データを更新中です",
      message: "最新の価格を取得できるまで借入は実行できません。",
      recovery: "少し待ってからもう一度お試しください。",
    });
  });

  it("allows risk and credit records to share unit-safe contracts", () => {
    const riskSnapshot = {
      grossReserveUsdWad: asWad(2_000_000_000_000_000_000n),
      adjustedReserveUsdWad: asWad(1_700_000_000_000_000_000n),
      creditLimitWad: asWad(1_360_000_000_000_000_000n),
      availableCreditWad: asWad(1_100_000_000_000_000_000n),
      healthFactorBps: asBasisPoints(12_500n),
      priceTimestamp: 1_755_000_000n,
      reserveTimestamp: 1_755_000_000n,
      status: "HEALTHY",
    } satisfies RiskSnapshot;

    const position = {
      borrower: asAddress("0x2222222222222222222222222222222222222222"),
      reserveAccountId: asAccountId(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
      principalWad: asWad(260_000_000_000_000_000n),
      status: riskSnapshot.status,
      openedAt: 1_755_000_000n,
      lastRiskSyncAt: 1_755_000_000n,
    } satisfies CreditPosition;

    expect(position.principalWad).toBe(260_000_000_000_000_000n);
  });
});
