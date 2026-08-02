/**
 * Shared business contracts for the Web app, attestation worker, and contracts.
 * Monetary values are integer fixed-point values; use the conversion helpers at
 * boundaries instead of JavaScript numbers.
 */

type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

export type Address = Brand<string, "Address">;
export type AccountId = Brand<string, "AccountId">;
export type ProofId = Brand<string, "ProofId">;
export type TransactionHash = Brand<string, "TransactionHash">;
export type Drops = Brand<bigint, "Drops">;
export type Wad = Brand<bigint, "Wad">;
export type BasisPoints = Brand<bigint, "BasisPoints">;

export const WAD_SCALE = 1_000_000_000_000_000_000n;
export const DROPS_PER_XRP = 1_000_000n;
export const WAD_PER_DROP = WAD_SCALE / DROPS_PER_XRP;

export class DomainValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

function assertNonNegative(value: bigint, label: string): void {
  if (value < 0n) {
    throw new DomainValidationError(`${label} must be non-negative.`);
  }
}

function assertHex(value: string, byteLength: number, label: string): void {
  const hexLength = byteLength * 2;
  const pattern = new RegExp(`^0x[0-9a-fA-F]{${hexLength}}$`);

  if (!pattern.test(value)) {
    throw new DomainValidationError(
      `${label} must be a ${byteLength}-byte hexadecimal value.`,
    );
  }
}

export function asAddress(value: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new DomainValidationError("Address must be a 20-byte EVM address.");
  }
  return value as Address;
}

export function asAccountId(value: string): AccountId {
  assertHex(value, 32, "Account ID");
  return value as AccountId;
}

export function asProofId(value: string): ProofId {
  assertHex(value, 32, "Proof ID");
  return value as ProofId;
}

export function asTransactionHash(value: string): TransactionHash {
  assertHex(value, 32, "Transaction hash");
  return value as TransactionHash;
}

export function asDrops(value: bigint): Drops {
  assertNonNegative(value, "Drops");
  return value as Drops;
}

export function asWad(value: bigint): Wad {
  assertNonNegative(value, "WAD");
  return value as Wad;
}

export function asBasisPoints(value: bigint): BasisPoints {
  assertNonNegative(value, "Basis points");
  return value as BasisPoints;
}

/** Converts XRP's native drops unit to the protocol's 18-decimal WAD unit. */
export function dropsToWad(value: Drops): Wad {
  return asWad(value * WAD_PER_DROP);
}

/** Converts WAD to drops, rounding down so a displayed withdrawal never overstates value. */
export function wadToDropsFloor(value: Wad): Drops {
  return asDrops(value / WAD_PER_DROP);
}

export type CreditStatus =
  | "HEALTHY"
  | "WARNING"
  | "MARGIN_CALL"
  | "PRICE_STALE"
  | "RESERVE_STALE"
  | "FROZEN";

export interface RiskSnapshot {
  readonly grossReserveUsdWad: Wad;
  readonly adjustedReserveUsdWad: Wad;
  readonly creditLimitWad: Wad;
  readonly availableCreditWad: Wad;
  readonly healthFactorBps: BasisPoints | "INFINITE";
  readonly priceTimestamp: bigint;
  readonly reserveTimestamp: bigint;
  readonly status: CreditStatus;
}

export interface CreditPosition {
  readonly borrower: Address;
  readonly reserveAccountId: AccountId;
  readonly principalWad: Wad;
  readonly status: CreditStatus;
  readonly openedAt: bigint;
  readonly lastRiskSyncAt: bigint;
}

export type AttestationStatus =
  | "PREPARING"
  | "READY_TO_SUBMIT"
  | "SUBMITTED"
  | "WAITING_FINALIZATION"
  | "FETCHING_PROOF"
  | "PROOF_READY"
  | "VERIFIED"
  | "FAILED"
  | "EXPIRED";

export type DomainErrorCode =
  | "CREDIT_NOT_HEALTHY"
  | "CREDIT_LIMIT_EXCEEDED"
  | "STALE_PRICE"
  | "STALE_RESERVE"
  | "BORROWING_PAUSED"
  | "ZERO_AMOUNT"
  | "EXCESS_REPAYMENT"
  | "INSUFFICIENT_RFUSD_ALLOWANCE"
  | "INSUFFICIENT_RFUSD_BALANCE"
  | "RFUSD_TRANSFER_FAILED"
  | "INVALID_XRPL_ADDRESS"
  | "INVALID_AMOUNT"
  | "NOT_FINALIZED"
  | "DA_UNAVAILABLE"
  | "INVALID_FDC_PROOF"
  | "FDC_FEE_UNAVAILABLE"
  | "INSUFFICIENT_C2FLR_FEE"
  | "PROOF_ALREADY_USED"
  | "PROOF_OWNER_MISMATCH"
  | "OUT_OF_ORDER_LEDGER"
  | "ACCOUNT_FROZEN";

export interface AttestationFailure {
  readonly code: DomainErrorCode;
  readonly message: string;
}

export interface AttestationRecord {
  readonly id: ProofId;
  readonly accountId: AccountId;
  readonly txHash: TransactionHash;
  readonly requestBytesHash: ProofId;
  readonly votingRoundId?: bigint;
  readonly status: AttestationStatus;
  readonly failure?: AttestationFailure;
  readonly createdAt: bigint;
  readonly updatedAt: bigint;
}

export type ActivityEventKind =
  | "RESERVE_REGISTERED"
  | "PROOF_SUBMITTED"
  | "PROOF_VERIFIED"
  | "PROOF_REJECTED"
  | "RESERVE_UPDATED"
  | "BORROWED"
  | "REPAID"
  | "RISK_CHANGED"
  | "BORROWING_PAUSED";

export interface ActivityEvent {
  readonly kind: ActivityEventKind;
  readonly occurredAt: bigint;
  readonly txHash?: TransactionHash;
  readonly details: Readonly<Record<string, string>>;
}

export interface UserFacingError {
  readonly code: DomainErrorCode;
  readonly title: string;
  readonly message: string;
  readonly recovery: string;
}

const ERROR_COPY: Readonly<
  Record<DomainErrorCode, Omit<UserFacingError, "code">>
> = {
  CREDIT_NOT_HEALTHY: {
    title: "担保の状態を確認してください",
    message: "現在の担保状態では借入を実行できません。",
    recovery: "担保を更新するか、返済してからもう一度お試しください。",
  },
  CREDIT_LIMIT_EXCEEDED: {
    title: "利用可能な与信枠を超えています",
    message: "入力した借入額は現在利用できる与信枠を上回っています。",
    recovery: "借入額を減らすか、担保を更新してください。",
  },
  STALE_PRICE: {
    title: "価格データを更新中です",
    message: "最新の価格を取得できるまで借入は実行できません。",
    recovery: "少し待ってからもう一度お試しください。",
  },
  STALE_RESERVE: {
    title: "準備金データを更新中です",
    message: "最新の準備金証明を確認できるまで借入は実行できません。",
    recovery: "準備金の更新後にもう一度お試しください。",
  },
  BORROWING_PAUSED: {
    title: "借入を一時停止しています",
    message: "安全確認のため、新規借入を一時停止しています。",
    recovery: "ダッシュボードの状態を確認して、時間をおいてください。",
  },
  ZERO_AMOUNT: {
    title: "金額を入力してください",
    message: "0より大きい金額を指定する必要があります。",
    recovery: "金額を確認してもう一度お試しください。",
  },
  EXCESS_REPAYMENT: {
    title: "返済額が残高を超えています",
    message: "借入残高を超える金額は返済できません。",
    recovery: "借入残高以下の金額を入力してください。",
  },
  INSUFFICIENT_RFUSD_ALLOWANCE: {
    title: "rfUSDの利用承認が必要です",
    message: "返済に必要なrfUSD利用承認が不足しています。",
    recovery: "ウォレットで利用承認を完了してから再実行してください。",
  },
  INSUFFICIENT_RFUSD_BALANCE: {
    title: "rfUSD残高が不足しています",
    message: "返済に必要なrfUSD残高がありません。",
    recovery: "残高を確認してからもう一度お試しください。",
  },
  RFUSD_TRANSFER_FAILED: {
    title: "rfUSDの送金に失敗しました",
    message: "返済用rfUSDの送金を完了できませんでした。",
    recovery: "ウォレット接続と残高を確認してから再試行してください。",
  },
  INVALID_XRPL_ADDRESS: {
    title: "XRPLアドレスが正しくありません",
    message: "入力されたXRPLアドレスを検証できませんでした。",
    recovery: "アドレスを確認してもう一度入力してください。",
  },
  INVALID_AMOUNT: {
    title: "金額が正しくありません",
    message: "指定された金額を処理できません。",
    recovery: "金額と小数点以下の桁数を確認してください。",
  },
  NOT_FINALIZED: {
    title: "取引の確定を待っています",
    message: "XRPL取引がまだ十分に確定していません。",
    recovery: "確定後に自動で処理を再開します。",
  },
  DA_UNAVAILABLE: {
    title: "証明データを取得できません",
    message: "一時的にデータ可用性レイヤーへ接続できません。",
    recovery: "時間をおいて再試行してください。",
  },
  INVALID_FDC_PROOF: {
    title: "証明を検証できませんでした",
    message: "取得したFDC証明を検証できませんでした。",
    recovery: "新しい証明を作成して再試行してください。",
  },
  FDC_FEE_UNAVAILABLE: {
    title: "FDC手数料を確認できません",
    message: "証明提出に必要な手数料を取得できませんでした。",
    recovery: "時間をおいて再試行してください。",
  },
  INSUFFICIENT_C2FLR_FEE: {
    title: "C2FLR残高が不足しています",
    message: "証明提出に必要なC2FLR手数料が不足しています。",
    recovery: "C2FLRを用意してから再試行してください。",
  },
  PROOF_ALREADY_USED: {
    title: "この証明は使用済みです",
    message: "同じ証明を再度登録することはできません。",
    recovery: "新しい準備金証明を作成してください。",
  },
  PROOF_OWNER_MISMATCH: {
    title: "証明の所有者が一致しません",
    message: "接続中のウォレットはこの証明を使用できません。",
    recovery: "正しいウォレットに接続してください。",
  },
  OUT_OF_ORDER_LEDGER: {
    title: "古い台帳情報です",
    message: "現在の準備金より古い台帳情報は登録できません。",
    recovery: "最新の準備金証明を作成してください。",
  },
  ACCOUNT_FROZEN: {
    title: "このアカウントは凍結されています",
    message: "安全確認のため、このアカウントの操作を停止しています。",
    recovery: "運営にお問い合わせください。",
  },
};

export function toUserFacingError(code: DomainErrorCode): UserFacingError {
  return { code, ...ERROR_COPY[code] };
}
