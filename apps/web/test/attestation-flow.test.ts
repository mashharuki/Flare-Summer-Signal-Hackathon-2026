import {
  asAccountId,
  asAddress,
  asProofId,
  asTransactionHash,
} from "@reserveflow/shared";
import { describe, expect, it, vi } from "vitest";

import {
  type AttestationFlowDependencies,
  createAttestationFlow,
} from "../src/attestation-flow.js";

const ACCOUNT_ID = asAccountId(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const REQUEST_ID = asProofId(
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
);
const BORROWER = asAddress("0x1111111111111111111111111111111111111111");
const XRPL_TRANSACTION_ID = asTransactionHash(
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
);
const FDC_TRANSACTION_ID = asTransactionHash(
  "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
);
const CORE_TRANSACTION_ID = asTransactionHash(
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
);

function createDependencies(): AttestationFlowDependencies {
  return {
    api: {
      confirmCoreSubmission: vi.fn().mockResolvedValue({ status: "VERIFIED" }),
      prepare: vi.fn().mockResolvedValue({
        id: REQUEST_ID,
        proofOwner: BORROWER,
        requestBytes: "0x1234",
        requestBytesHash: REQUEST_ID,
        requiredFeeWei: 100n,
      }),
      recordSubmitted: vi.fn().mockResolvedValue({ status: "SUBMITTED" }),
      refresh: vi.fn().mockResolvedValue({
        encodedProof: "0xdead",
        status: "PROOF_READY",
      }),
    },
    wallet: {
      submitFdcHubRequest: vi.fn().mockResolvedValue(FDC_TRANSACTION_ID),
      submitReserveProof: vi.fn().mockResolvedValue(CORE_TRANSACTION_ID),
    },
  };
}

describe("non-custodial attestation flow", () => {
  it("makes the connected borrower wallet pay the exact FDC fee and submit the Core proof", async () => {
    const dependencies = createDependencies();
    const flow = createAttestationFlow(dependencies);

    const result = await flow.run({
      accountId: ACCOUNT_ID,
      borrower: BORROWER,
      transactionId: XRPL_TRANSACTION_ID,
    });

    expect(dependencies.wallet.submitFdcHubRequest).toHaveBeenCalledWith({
      requestBytes: "0x1234",
      value: 100n,
    });
    expect(dependencies.api.recordSubmitted).toHaveBeenCalledWith({
      requestBytesHash: REQUEST_ID,
      requestTransactionHash: FDC_TRANSACTION_ID,
    });
    expect(dependencies.wallet.submitReserveProof).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      encodedProof: "0xdead",
    });
    expect(dependencies.api.confirmCoreSubmission).toHaveBeenCalledWith({
      requestBytesHash: REQUEST_ID,
      transactionHash: CORE_TRANSACTION_ID,
    });
    expect(result.status).toBe("VERIFIED");
  });

  it("never submits a Core proof until the Worker has reported PROOF_READY", async () => {
    const dependencies = createDependencies();
    dependencies.api.refresh = vi.fn().mockResolvedValue({
      status: "WAITING_FINALIZATION",
    });
    const flow = createAttestationFlow(dependencies);

    await expect(
      flow.run({
        accountId: ACCOUNT_ID,
        borrower: BORROWER,
        transactionId: XRPL_TRANSACTION_ID,
      }),
    ).resolves.toMatchObject({ status: "WAITING_FINALIZATION" });
    expect(dependencies.wallet.submitReserveProof).not.toHaveBeenCalled();
  });

  it("rejects a prepared request whose proof owner is not the connected borrower", async () => {
    const dependencies = createDependencies();
    dependencies.api.prepare = vi.fn().mockResolvedValue({
      id: REQUEST_ID,
      proofOwner: asAddress("0x2222222222222222222222222222222222222222"),
      requestBytes: "0x1234",
      requestBytesHash: REQUEST_ID,
      requiredFeeWei: 100n,
    });
    const flow = createAttestationFlow(dependencies);

    await expect(
      flow.run({
        accountId: ACCOUNT_ID,
        borrower: BORROWER,
        transactionId: XRPL_TRANSACTION_ID,
      }),
    ).rejects.toThrow("proof owner");
    expect(dependencies.wallet.submitFdcHubRequest).not.toHaveBeenCalled();
  });
});
