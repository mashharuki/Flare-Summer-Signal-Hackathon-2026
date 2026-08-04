import {
  type AttestationRecord,
  asAccountId,
  asAddress,
  asProofId,
  asTransactionHash,
} from "@reserveflow/shared";
import { describe, expect, it } from "vitest";

import {
  buildFdcHubSubmission,
  buildReserveAttestationTimeline,
  validateXrplTestnetAddress,
  WebAppError,
} from "./../src/attestation-timeline.js";

const ACCOUNT_ID = asAccountId(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const PROOF_ID = asProofId(
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
);
const TX_HASH = asTransactionHash(
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
);
const BORROWER = asAddress("0x1111111111111111111111111111111111111111");

function createRecord(status: AttestationRecord["status"]): AttestationRecord {
  return {
    accountId: ACCOUNT_ID,
    createdAt: 1n,
    id: PROOF_ID,
    requestBytesHash: PROOF_ID,
    status,
    txHash: TX_HASH,
    updatedAt: 1n,
  };
}

describe("reserve attestation timeline", () => {
  it("accepts only a validated XRPL Testnet classic address", () => {
    expect(
      validateXrplTestnetAddress(
        "rELiPixQHM5NLgMqXovBmwZCYw6tFKZxh8",
        () => true,
      ),
    ).toBe("rELiPixQHM5NLgMqXovBmwZCYw6tFKZxh8");
    expect(() =>
      validateXrplTestnetAddress("not-an-xrpl-address", () => false),
    ).toThrow(
      new WebAppError(
        "INVALID_XRPL_ADDRESS",
        "XRPL Testnetの有効なclassic addressを入力してください。",
      ),
    );
  });

  it("keeps verifier request bytes unchanged and attaches exactly the required C2FLR fee", () => {
    const submission = buildFdcHubSubmission({
      expiresAt: "2026-08-04T00:01:00.000Z",
      id: PROOF_ID,
      proofOwner: BORROWER,
      requestBytes: "0x1234",
      requestBytesHash: PROOF_ID,
      requiredFeeWei: 100n,
      sourceId: "testXRP",
    });

    expect(submission).toEqual({
      requestBytes: "0x1234",
      valueWei: 100n,
    });
  });

  it("shows required fee, signature, finalization, proof, and wallet-only final submission as a timeline", () => {
    const timeline = buildReserveAttestationTimeline({
      prepared: {
        expiresAt: "2026-08-04T00:01:00.000Z",
        id: PROOF_ID,
        proofOwner: BORROWER,
        requestBytes: "0x1234",
        requestBytesHash: PROOF_ID,
        requiredFeeWei: 100n,
        sourceId: "testXRP",
      },
      record: createRecord("PROOF_READY"),
    });

    expect(timeline.steps.map((step) => step.kind)).toEqual([
      "FEE_READY",
      "WALLET_SIGNATURE",
      "WAITING_FINALIZATION",
      "PROOF_READY",
      "SUBMIT_TO_CORE",
    ]);
    expect(timeline.nextAction).toEqual({
      kind: "SUBMIT_TO_CORE",
      label: "ウォレットでReserveFlowCoreへ証明を提出",
    });
    expect(timeline.steps[0]).toMatchObject({ requiredFeeWei: 100n });
  });

  it("surfaces a failed proof reason without claiming a reserve update", () => {
    const timeline = buildReserveAttestationTimeline({
      record: {
        ...createRecord("FAILED"),
        failure: {
          code: "INVALID_FDC_PROOF",
          message: "FDC proof could not be verified.",
        },
      },
    });

    expect(timeline.nextAction).toEqual({
      kind: "RETRY",
      label: "証明を確認して再申請",
    });
    expect(timeline.notice).toBe("FDC proof could not be verified.");
    expect(timeline.reserveUpdated).toBe(false);
  });
});
