import type {
  AccountId,
  Address,
  AttestationStatus,
  ProofId,
  TransactionHash,
} from "@reserveflow/shared";

export interface PreparedAttestation {
  readonly id: ProofId;
  readonly proofOwner: Address;
  readonly requestBytes: `0x${string}`;
  readonly requestBytesHash: ProofId;
  readonly requiredFeeWei: bigint;
}

export interface AttestationApiClient {
  confirmCoreSubmission(input: {
    readonly requestBytesHash: ProofId;
    readonly transactionHash: TransactionHash;
  }): Promise<{ readonly status: string }>;
  prepare(input: {
    readonly accountId: AccountId;
    readonly transactionId: TransactionHash;
  }): Promise<PreparedAttestation>;
  recordSubmitted(input: {
    readonly requestBytesHash: ProofId;
    readonly requestTransactionHash: TransactionHash;
  }): Promise<{ readonly status: string }>;
  refresh(input: {
    readonly requestBytesHash: ProofId;
  }): Promise<
    | { readonly status: Exclude<AttestationStatus, "PROOF_READY"> }
    | { readonly encodedProof: `0x${string}`; readonly status: "PROOF_READY" }
  >;
}

export interface AttestationWallet {
  /** The browser wallet pays C2FLR directly to FdcHub. */
  submitFdcHubRequest(input: {
    readonly requestBytes: `0x${string}`;
    readonly value: bigint;
  }): Promise<TransactionHash>;
  /** The browser wallet alone calls ReserveFlowCore after a proof is ready. */
  submitReserveProof(input: {
    readonly accountId: AccountId;
    readonly encodedProof: `0x${string}`;
  }): Promise<TransactionHash>;
}

export interface AttestationFlowDependencies {
  readonly api: AttestationApiClient;
  readonly wallet: AttestationWallet;
}

export interface AttestationFlowInput {
  readonly accountId: AccountId;
  readonly borrower: Address;
  readonly transactionId: TransactionHash;
}

/**
 * A one-shot browser state transition. If FDC is still finalizing it returns
 * the status and can safely be retried; it never asks a Worker to sign.
 */
export function createAttestationFlow(
  dependencies: AttestationFlowDependencies,
): {
  refreshAndSubmit(input: {
    readonly accountId: AccountId;
    readonly requestBytesHash: ProofId;
  }): Promise<{ readonly status: string }>;
  run(input: AttestationFlowInput): Promise<{ readonly status: string }>;
  start(input: AttestationFlowInput): Promise<{
    readonly requestBytesHash: ProofId;
    readonly status: string;
  }>;
} {
  return {
    async start(input) {
      const prepared = await dependencies.api.prepare({
        accountId: input.accountId,
        transactionId: input.transactionId,
      });
      if (prepared.proofOwner.toLowerCase() !== input.borrower.toLowerCase()) {
        throw new Error(
          "Prepared FDC proof owner does not match the connected borrower wallet.",
        );
      }
      const requestTransactionHash =
        await dependencies.wallet.submitFdcHubRequest({
          requestBytes: prepared.requestBytes,
          value: prepared.requiredFeeWei,
        });
      await dependencies.api.recordSubmitted({
        requestBytesHash: prepared.requestBytesHash,
        requestTransactionHash,
      });
      return {
        requestBytesHash: prepared.requestBytesHash,
        status: "SUBMITTED",
      };
    },
    async refreshAndSubmit({ accountId, requestBytesHash }) {
      const refreshed = await dependencies.api.refresh({
        requestBytesHash,
      });
      if (refreshed.status !== "PROOF_READY") {
        return refreshed;
      }
      const transactionHash = await dependencies.wallet.submitReserveProof({
        accountId,
        encodedProof: refreshed.encodedProof,
      });
      return dependencies.api.confirmCoreSubmission({
        requestBytesHash,
        transactionHash,
      });
    },
    async run(input) {
      const started = await this.start(input);
      return this.refreshAndSubmit({
        accountId: input.accountId,
        requestBytesHash: started.requestBytesHash,
      });
    },
  };
}
