import {
  asWad,
  type BasisPoints,
  type CreditPosition,
  type CreditStatus,
  type RiskSnapshot,
  toUserFacingError,
  type UserFacingError,
  WAD_SCALE,
  type Wad,
} from "@reserveflow/shared";

const BASIS_POINTS = 10_000n;
const MVP_HAIRCUT_BPS = 3_000n;
const MVP_MAX_LTV_BPS = 5_000n;

export interface CreditDashboard {
  readonly freshness: {
    readonly priceTimestamp: bigint;
    readonly reserveTimestamp: bigint;
  };
  readonly metrics: {
    readonly adjustedReserveUsdWad: Wad;
    readonly availableCreditWad: Wad;
    readonly creditLimitWad: Wad;
    readonly grossReserveUsdWad: Wad;
    readonly haircutBps: bigint;
    readonly healthFactorBps: BasisPoints | "INFINITE";
    readonly maxLtvBps: bigint;
    readonly principalWad: Wad;
  };
  readonly risk: RiskExplanation;
}

export interface RiskExplanation {
  readonly borrowingEnabled: boolean;
  readonly label: string;
  readonly recovery: string;
  readonly status: CreditStatus;
}

export interface PriceDropPreview {
  readonly availableCreditWad: Wad;
  readonly creditLimitWad: Wad;
  readonly dropBps: BasisPoints;
  readonly healthFactorBps: BasisPoints | "INFINITE";
  readonly isReadOnly: true;
  readonly status: CreditStatus;
}

export interface BorrowPreview {
  readonly allowed: boolean;
  readonly availableCreditWad: Wad;
  readonly blockingReason?: UserFacingError;
  readonly healthFactorBps: BasisPoints | "INFINITE";
  readonly principalWad: Wad;
}

export type RepaymentPreview =
  | {
      readonly action: "BLOCKED";
      readonly blockingReason: UserFacingError;
    }
  | {
      readonly action: "APPROVE" | "REPAY";
      readonly availableCreditWad: Wad;
      readonly principalWad: Wad;
    };

export function buildCreditDashboard(input: {
  readonly position: CreditPosition;
  readonly risk: RiskSnapshot;
}): CreditDashboard {
  return {
    freshness: {
      priceTimestamp: input.risk.priceTimestamp,
      reserveTimestamp: input.risk.reserveTimestamp,
    },
    metrics: {
      adjustedReserveUsdWad: input.risk.adjustedReserveUsdWad,
      availableCreditWad: input.risk.availableCreditWad,
      creditLimitWad: input.risk.creditLimitWad,
      grossReserveUsdWad: input.risk.grossReserveUsdWad,
      haircutBps: MVP_HAIRCUT_BPS,
      healthFactorBps: input.risk.healthFactorBps,
      maxLtvBps: MVP_MAX_LTV_BPS,
      principalWad: input.position.principalWad,
    },
    risk: explainRisk(input.risk.status),
  };
}

export function buildPriceDropPreview(input: {
  readonly dropBps: BasisPoints;
  readonly simulatedRisk: RiskSnapshot;
}): PriceDropPreview {
  return {
    availableCreditWad: input.simulatedRisk.availableCreditWad,
    creditLimitWad: input.simulatedRisk.creditLimitWad,
    dropBps: input.dropBps,
    healthFactorBps: input.simulatedRisk.healthFactorBps,
    isReadOnly: true,
    status: input.simulatedRisk.status,
  };
}

export function buildBorrowPreview(input: {
  readonly amountWad: Wad;
  readonly borrowingPaused?: boolean;
  readonly position: CreditPosition;
  readonly risk: RiskSnapshot;
}): BorrowPreview {
  const projectedPrincipal = asWad(
    input.position.principalWad + input.amountWad,
  );
  const projectedAvailable = availableCredit(
    input.risk.creditLimitWad,
    projectedPrincipal,
  );
  const projectedHealth = healthFactor(
    input.risk.creditLimitWad,
    projectedPrincipal,
  );
  const blockingCode = input.borrowingPaused
    ? "BORROWING_PAUSED"
    : borrowBlockCode(input.risk.status, input.amountWad, input.risk);

  return {
    allowed: !blockingCode,
    availableCreditWad: projectedAvailable,
    ...(blockingCode
      ? { blockingReason: toUserFacingError(blockingCode) }
      : {}),
    healthFactorBps: projectedHealth,
    principalWad: projectedPrincipal,
  };
}

export function buildRepaymentPreview(input: {
  readonly allowanceWad: Wad;
  readonly amountWad: Wad;
  readonly balanceWad: Wad;
  readonly position: CreditPosition;
  readonly risk: RiskSnapshot;
}): RepaymentPreview {
  if (input.amountWad === 0n) {
    return {
      action: "BLOCKED",
      blockingReason: toUserFacingError("ZERO_AMOUNT"),
    };
  }
  if (input.amountWad > input.position.principalWad) {
    return {
      action: "BLOCKED",
      blockingReason: toUserFacingError("EXCESS_REPAYMENT"),
    };
  }
  if (input.allowanceWad < input.amountWad) {
    return repaymentSuccessPreview(input, "APPROVE");
  }
  if (input.balanceWad < input.amountWad) {
    return {
      action: "BLOCKED",
      blockingReason: toUserFacingError("INSUFFICIENT_RFUSD_BALANCE"),
    };
  }
  return repaymentSuccessPreview(input, "REPAY");
}

export function formatRfUsd(value: Wad): string {
  const whole = value / WAD_SCALE;
  const fractional = (value % WAD_SCALE)
    .toString()
    .padStart(18, "0")
    .slice(0, 3)
    .replace(/0+$/, "");
  return `${whole}${fractional ? `.${fractional}` : ""} rfUSD`;
}

export function formatUsd(value: Wad): string {
  return `$${formatRfUsd(value).replace(" rfUSD", "")}`;
}

export function formatHealthFactor(value: BasisPoints | "INFINITE"): string {
  if (value === "INFINITE") {
    return "∞";
  }
  const whole = value / 100n;
  const fractional = (value % 100n).toString().padStart(2, "0");
  return `${whole}.${fractional}%`;
}

/** Parses at most three displayed rfUSD decimals into the protocol's WAD unit. */
export function parseRfUsd(value: string): Wad | undefined {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,3}))?$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const wholePart = match[1];
  if (!wholePart) {
    return undefined;
  }
  const whole = BigInt(wholePart);
  const fractional = BigInt((match[2] ?? "").padEnd(3, "0"));
  return asWad(whole * WAD_SCALE + fractional * 1_000_000_000_000_000n);
}

function availableCredit(limitWad: Wad, principalWad: Wad): Wad {
  return asWad(limitWad > principalWad ? limitWad - principalWad : 0n);
}

function healthFactor(
  creditLimitWad: Wad,
  principalWad: Wad,
): BasisPoints | "INFINITE" {
  if (principalWad === 0n) {
    return "INFINITE";
  }
  return ((creditLimitWad * BASIS_POINTS) / principalWad) as BasisPoints;
}

function borrowBlockCode(
  status: CreditStatus,
  amountWad: Wad,
  risk: RiskSnapshot,
): UserFacingError["code"] | undefined {
  if (amountWad === 0n) {
    return "ZERO_AMOUNT";
  }
  if (status === "PRICE_STALE") {
    return "STALE_PRICE";
  }
  if (status === "RESERVE_STALE") {
    return "STALE_RESERVE";
  }
  if (status === "FROZEN") {
    return "ACCOUNT_FROZEN";
  }
  if (status === "WARNING" || status === "MARGIN_CALL") {
    return "CREDIT_NOT_HEALTHY";
  }
  if (amountWad > risk.availableCreditWad) {
    return "CREDIT_LIMIT_EXCEEDED";
  }
  return undefined;
}

function explainRisk(status: CreditStatus): RiskExplanation {
  switch (status) {
    case "HEALTHY":
      return {
        borrowingEnabled: true,
        label: "健全 — 新規借入が可能です",
        recovery: "価格と準備金証明の鮮度を維持してください。",
        status,
      };
    case "PRICE_STALE":
      return {
        borrowingEnabled: false,
        label: "価格の鮮度切れ — 新規借入を停止中",
        recovery: "価格データの更新を待ってから再試行してください。",
        status,
      };
    case "RESERVE_STALE":
      return {
        borrowingEnabled: false,
        label: "準備金証明の鮮度切れ — 新規借入を停止中",
        recovery: "新しい準備金証明を完了してから再試行してください。",
        status,
      };
    case "WARNING":
      return {
        borrowingEnabled: false,
        label: "警告 — 新規借入を停止中",
        recovery: "返済または準備金の更新で健全性を回復してください。",
        status,
      };
    case "MARGIN_CALL":
      return {
        borrowingEnabled: false,
        label: "マージンコール — 新規借入を停止中",
        recovery: "返済または担保リスクの低減を行ってください。",
        status,
      };
    case "FROZEN":
      return {
        borrowingEnabled: false,
        label: "アカウント凍結 — 新規借入を停止中",
        recovery:
          "返済は継続できます。解除はRisk Adminの確認後に反映されます。",
        status,
      };
  }
}

function repaymentSuccessPreview(
  input: Parameters<typeof buildRepaymentPreview>[0],
  action: "APPROVE" | "REPAY",
): Extract<RepaymentPreview, { readonly action: "APPROVE" | "REPAY" }> {
  const principalWad = asWad(input.position.principalWad - input.amountWad);
  return {
    action,
    availableCreditWad: availableCredit(
      input.risk.creditLimitWad,
      principalWad,
    ),
    principalWad,
  };
}
