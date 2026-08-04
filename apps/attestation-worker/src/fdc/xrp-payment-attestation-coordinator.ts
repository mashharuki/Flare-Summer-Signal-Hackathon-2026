import {
  type AccountId,
  type Address,
  asProofId,
  type ProofId,
  type TransactionHash,
} from "@reserveflow/shared";
import { keccak256 } from "viem";

import type {
  PersistedAttestationRecord,
  SqliteAttestationStore,
} from "../persistence/attestation-store.js";
import { votingRoundForRequestBlock } from "./voting-round.js";

export interface ReserveAccountReader {
  getReserveAccount(accountId: AccountId): Promise<{
    readonly borrower: Address;
    readonly sourceId: string;
  }>;
}

export interface XrpPaymentVerifier {
  prepareXrpPayment(input: {
    readonly proofOwner: Address;
    readonly sourceId: "testXRP";
    readonly transactionId: TransactionHash;
  }): Promise<{ readonly requestBytes: `0x${string}` }>;
}

export interface FdcHubReceiptReader {
  readonly address: Address;
  getRequestFee(requestBytes: `0x${string}`): Promise<bigint>;
  getRequestReceipt(transactionHash: TransactionHash): Promise<{
    readonly blockTimestamp: bigint;
    readonly chainId: number;
    readonly paidFeeWei: bigint;
    readonly requestBytes: `0x${string}`;
    readonly status: "reverted" | "success";
    readonly to: Address;
  }>;
  getVotingRoundParameters(): Promise<{
    readonly firstVotingRoundStartTimestamp: bigint;
    readonly votingEpochDurationSeconds: bigint;
  }>;
}

export interface XrpPaymentAttestationCoordinatorDependencies {
  readonly accountReader: ReserveAccountReader;
  readonly fdcHub: FdcHubReceiptReader;
  readonly now: () => Date;
  readonly requestTtlMilliseconds: number;
  readonly store: SqliteAttestationStore;
  readonly verifier: XrpPaymentVerifier;
}

export interface PreparedXrpPaymentAttestation {
  readonly expiresAt: string;
  readonly id: ProofId;
  readonly proofOwner: Address;
  readonly requestBytes: `0x${string}`;
  readonly requestBytesHash: ProofId;
  readonly requiredFeeWei: bigint;
  readonly sourceId: "testXRP";
}

const COSTON2_CHAIN_ID = 114;

/**
 * Non-custodial FDC request coordinator. The caller sends FdcHub transactions;
 * this class only prepares requests and verifies the resulting receipts.
 */
export class XrpPaymentAttestationCoordinator {
  public constructor(
    private readonly dependencies: XrpPaymentAttestationCoordinatorDependencies,
  ) {
    if (
      !Number.isSafeInteger(dependencies.requestTtlMilliseconds) ||
      dependencies.requestTtlMilliseconds <= 0
    ) {
      throw new Error(
        "FDC request TTL must be a positive integer in milliseconds.",
      );
    }
  }

  public async prepare(input: {
    readonly accountId: AccountId;
    readonly transactionId: TransactionHash;
  }): Promise<PreparedXrpPaymentAttestation> {
    const account = await this.dependencies.accountReader.getReserveAccount(
      input.accountId,
    );
    if (account.sourceId !== "testXRP") {
      throw new Error(
        "Only testXRP reserve accounts are supported by this MVP.",
      );
    }

    const verifierResponse = await this.dependencies.verifier.prepareXrpPayment(
      {
        proofOwner: account.borrower,
        sourceId: "testXRP",
        transactionId: input.transactionId,
      },
    );
    const requiredFeeWei = await this.dependencies.fdcHub.getRequestFee(
      verifierResponse.requestBytes,
    );
    if (requiredFeeWei < 0n) {
      throw new Error("FdcHub returned a negative request fee.");
    }

    const requestBytesHash = asProofId(
      keccak256(verifierResponse.requestBytes),
    );
    const expiresAt = this.expiresAt();
    const record = await this.dependencies.store.createOrGetPrepared({
      accountId: input.accountId,
      expiresAt,
      id: requestBytesHash,
      proofOwner: account.borrower,
      requestBytes: verifierResponse.requestBytes,
      requestBytesHash,
      requiredFeeWei,
      txHash: input.transactionId,
    });
    return preparedFromRecord(record);
  }

  public async recordSubmitted(input: {
    readonly requestBytesHash: ProofId;
    readonly requestTransactionHash: TransactionHash;
  }): Promise<PersistedAttestationRecord> {
    const record = await this.dependencies.store.getByRequestBytesHash(
      input.requestBytesHash,
    );
    if (!record) {
      throw new Error(
        `Attestation request ${input.requestBytesHash} was not found.`,
      );
    }
    const metadata = requireRequestMetadata(record);
    if (metadata.expiresAt <= BigInt(this.dependencies.now().getTime())) {
      await this.dependencies.store.markExpired(input.requestBytesHash);
      throw new Error(
        "Attestation request has expired before FdcHub submission.",
      );
    }

    const receipt = await this.dependencies.fdcHub.getRequestReceipt(
      input.requestTransactionHash,
    );
    if (receipt.chainId !== COSTON2_CHAIN_ID) {
      throw new Error("FdcHub receipt is not on Coston2.");
    }
    if (receipt.status !== "success") {
      throw new Error(
        "FdcHub attestation request transaction did not succeed.",
      );
    }
    if (!equalAddress(receipt.to, this.dependencies.fdcHub.address)) {
      throw new Error("Receipt target is not the configured Coston2 FdcHub.");
    }
    if (!equalHex(receipt.requestBytes, metadata.requestBytes)) {
      throw new Error(
        "FdcHub receipt request bytes do not match the prepared request.",
      );
    }
    if (receipt.paidFeeWei !== metadata.requiredFeeWei) {
      throw new Error(
        "FdcHub receipt did not pay the required C2FLR fee exactly.",
      );
    }

    const votingRound =
      await this.dependencies.fdcHub.getVotingRoundParameters();
    const votingRoundId = votingRoundForRequestBlock({
      blockTimestamp: receipt.blockTimestamp,
      firstVotingRoundStartTimestamp:
        votingRound.firstVotingRoundStartTimestamp,
      votingEpochDurationSeconds: votingRound.votingEpochDurationSeconds,
    });
    return this.dependencies.store.markSubmitted(input.requestBytesHash, {
      requestTransactionHash: input.requestTransactionHash,
      votingRoundId,
    });
  }

  private expiresAt(): bigint {
    return BigInt(
      this.dependencies.now().getTime() +
        this.dependencies.requestTtlMilliseconds,
    );
  }
}

function preparedFromRecord(
  record: PersistedAttestationRecord,
): PreparedXrpPaymentAttestation {
  const metadata = requireRequestMetadata(record);
  return {
    expiresAt: new Date(Number(metadata.expiresAt)).toISOString(),
    id: record.id,
    proofOwner: metadata.proofOwner,
    requestBytes: metadata.requestBytes,
    requestBytesHash: record.requestBytesHash,
    requiredFeeWei: metadata.requiredFeeWei,
    sourceId: "testXRP",
  };
}

function requireRequestMetadata(record: PersistedAttestationRecord): {
  readonly expiresAt: bigint;
  readonly proofOwner: Address;
  readonly requestBytes: `0x${string}`;
  readonly requiredFeeWei: bigint;
} {
  if (
    record.expiresAt === undefined ||
    record.proofOwner === undefined ||
    record.requestBytes === undefined ||
    record.requiredFeeWei === undefined
  ) {
    throw new Error(
      "Attestation record is missing prepared request metadata and cannot be resumed safely.",
    );
  }
  return {
    expiresAt: record.expiresAt,
    proofOwner: record.proofOwner,
    requestBytes: record.requestBytes,
    requiredFeeWei: record.requiredFeeWei,
  };
}

function equalAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function equalHex(left: `0x${string}`, right: `0x${string}`): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
