import { describe, expect, it, vi } from "vitest";

import {
  FDC_XRP_PAYMENT_CONFIRMATION,
  requestXrpPaymentProof,
  TEST_XRP_SOURCE_ID,
  XRPL_PAYMENT_ATTESTATION_TYPE,
  type XrpPaymentProof,
  type XrpPaymentProofGateway,
} from "./../../src/fdc/request-xrp-payment-proof.js";

const ACCOUNT_ID: `0x${string}` =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EXTERNAL_ADDRESS_HASH: `0x${string}` =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PROOF_OWNER: `0x${string}` = "0x1111111111111111111111111111111111111111";
const TRANSACTION_ID: `0x${string}` =
  "0x0fbac778a6e185c261225f46a3eb3713d65102d865defd0d02871dfc97584971";

function createGateway(): XrpPaymentProofGateway {
  return {
    prepare: vi.fn().mockResolvedValue({
      abiEncodedRequest: "0x1234",
    }),
    getRequestFee: vi.fn().mockResolvedValue(100n),
    submitAttestationRequest: vi.fn().mockResolvedValue({
      transactionHash:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      votingRoundId: 123n,
    }),
    waitForRoundFinalization: vi.fn().mockResolvedValue(undefined),
    getProof: vi.fn().mockResolvedValue(createProof(EXTERNAL_ADDRESS_HASH)),
    submitReserveProof: vi.fn().mockResolvedValue({
      transactionHash:
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    }),
  };
}

function createProof(receivingAddressHash: `0x${string}`): XrpPaymentProof {
  return {
    merkleProof: [],
    data: {
      attestationType: XRPL_PAYMENT_ATTESTATION_TYPE,
      lowestUsedTimestamp: 1n,
      requestBody: { proofOwner: PROOF_OWNER, transactionId: TRANSACTION_ID },
      responseBody: {
        blockNumber: 1n,
        blockTimestamp: 1n,
        destinationTag: 0n,
        firstMemoData: "0x",
        hasDestinationTag: false,
        hasMemoData: false,
        intendedReceivedAmount: 2_000_000n,
        intendedReceivingAddressHash: receivingAddressHash,
        intendedSpentAmount: 2_000_012n,
        receivedAmount: 2_000_000n,
        receivingAddressHash,
        sourceAddress: "rSource",
        sourceAddressHash:
          "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" as `0x${string}`,
        spentAmount: 2_000_012n,
        status: 0,
      },
      sourceId: TEST_XRP_SOURCE_ID,
      votingRound: 123n,
    },
  };
}

describe("requestXrpPaymentProof", () => {
  it("refuses to create an FDC request without explicit confirmation", async () => {
    const gateway = createGateway();

    await expect(
      requestXrpPaymentProof(
        {
          accountId: ACCOUNT_ID,
          confirmation: "",
          expectedDirection: "incoming",
          externalAddressHash: EXTERNAL_ADDRESS_HASH,
          proofOwner: PROOF_OWNER,
          signerAddress: PROOF_OWNER,
          transactionId: TRANSACTION_ID,
        },
        gateway,
      ),
    ).rejects.toThrow(
      `Set FDC_XRP_PAYMENT_CONFIRM=${FDC_XRP_PAYMENT_CONFIRMATION}`,
    );

    expect(gateway.prepare).not.toHaveBeenCalled();
    expect(gateway.submitAttestationRequest).not.toHaveBeenCalled();
    expect(gateway.submitReserveProof).not.toHaveBeenCalled();
  });

  it("binds the FDC proof to the signer and submits only a matching incoming payment", async () => {
    const gateway = createGateway();

    const result = await requestXrpPaymentProof(
      {
        accountId: ACCOUNT_ID,
        confirmation: FDC_XRP_PAYMENT_CONFIRMATION,
        expectedDirection: "incoming",
        externalAddressHash: EXTERNAL_ADDRESS_HASH,
        proofOwner: PROOF_OWNER,
        signerAddress: PROOF_OWNER,
        transactionId: TRANSACTION_ID,
      },
      gateway,
    );

    expect(gateway.prepare).toHaveBeenCalledWith({
      proofOwner: PROOF_OWNER,
      transactionId: TRANSACTION_ID,
    });
    expect(gateway.submitAttestationRequest).toHaveBeenCalledWith({
      abiEncodedRequest: "0x1234",
      requestFee: 100n,
    });
    expect(gateway.waitForRoundFinalization).toHaveBeenCalledWith(123n);
    expect(gateway.submitReserveProof).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      proof: expect.any(Object),
    });
    expect(result).toEqual({
      attestationRequestTransactionHash:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      reserveProofTransactionHash:
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      votingRoundId: 123n,
    });
  });

  it("refuses a proof owner that differs from the Coston2 signer", async () => {
    const gateway = createGateway();

    await expect(
      requestXrpPaymentProof(
        {
          accountId: ACCOUNT_ID,
          confirmation: FDC_XRP_PAYMENT_CONFIRMATION,
          expectedDirection: "incoming",
          externalAddressHash: EXTERNAL_ADDRESS_HASH,
          proofOwner: "0x2222222222222222222222222222222222222222",
          signerAddress: PROOF_OWNER,
          transactionId: TRANSACTION_ID,
        },
        gateway,
      ),
    ).rejects.toThrow("must match the borrower wallet");

    expect(gateway.prepare).not.toHaveBeenCalled();
    expect(gateway.submitAttestationRequest).not.toHaveBeenCalled();
  });

  it("reuses an existing attestation request instead of paying a duplicate FDC fee", async () => {
    const gateway = createGateway();
    const existingRequestHash: `0x${string}` =
      "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    gateway.findExistingAttestation = vi.fn().mockResolvedValue({
      transactionHash: existingRequestHash,
      votingRoundId: 122n,
    });

    const result = await requestXrpPaymentProof(
      {
        accountId: ACCOUNT_ID,
        confirmation: FDC_XRP_PAYMENT_CONFIRMATION,
        expectedDirection: "incoming",
        externalAddressHash: EXTERNAL_ADDRESS_HASH,
        proofOwner: PROOF_OWNER,
        signerAddress: PROOF_OWNER,
        transactionId: TRANSACTION_ID,
      },
      gateway,
    );

    expect(gateway.getRequestFee).not.toHaveBeenCalled();
    expect(gateway.submitAttestationRequest).not.toHaveBeenCalled();
    expect(gateway.getProof).toHaveBeenCalledWith({
      abiEncodedRequest: "0x1234",
      votingRoundId: 122n,
    });
    expect(result.attestationRequestTransactionHash).toBe(existingRequestHash);
  });

  it("stops before the ReserveFlow call when the proof targets another XRPL address", async () => {
    const gateway = createGateway();
    vi.mocked(gateway.getProof).mockResolvedValue(
      createProof(
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      ),
    );

    await expect(
      requestXrpPaymentProof(
        {
          accountId: ACCOUNT_ID,
          confirmation: FDC_XRP_PAYMENT_CONFIRMATION,
          expectedDirection: "incoming",
          externalAddressHash: EXTERNAL_ADDRESS_HASH,
          proofOwner: PROOF_OWNER,
          signerAddress: PROOF_OWNER,
          transactionId: TRANSACTION_ID,
        },
        gateway,
      ),
    ).rejects.toThrow("does not match the configured incoming reserve address");

    expect(gateway.submitReserveProof).not.toHaveBeenCalled();
  });
});
