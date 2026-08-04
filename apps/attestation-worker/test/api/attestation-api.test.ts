import {
  asAccountId,
  asAddress,
  asProofId,
  asTransactionHash,
} from "@reserveflow/shared";
import { describe, expect, it, vi } from "vitest";

import {
  type AttestationApiDependencies,
  createAttestationApi,
} from "../../src/api/attestation-api.js";

const ACCOUNT_ID = asAccountId(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const REQUEST_ID = asProofId(
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
);
const BORROWER = asAddress("0x1111111111111111111111111111111111111111");
const OTHER_ACCOUNT = asAddress("0x2222222222222222222222222222222222222222");
const XRPL_TRANSACTION_ID = asTransactionHash(
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
);
const COSTON2_TRANSACTION_ID = asTransactionHash(
  "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
);

function createDependencies(
  overrides: Partial<AttestationApiDependencies> = {},
): AttestationApiDependencies {
  return {
    authorize: vi.fn().mockResolvedValue(BORROWER),
    coordinator: {
      confirmCoreSubmission: vi.fn().mockResolvedValue({
        accountId: ACCOUNT_ID,
        createdAt: 1n,
        id: REQUEST_ID,
        requestBytesHash: REQUEST_ID,
        status: "VERIFIED",
        txHash: XRPL_TRANSACTION_ID,
        updatedAt: 2n,
      }),
      get: vi.fn().mockResolvedValue({
        accountId: ACCOUNT_ID,
        createdAt: 1n,
        id: REQUEST_ID,
        proofOwner: BORROWER,
        requestBytesHash: REQUEST_ID,
        status: "READY_TO_SUBMIT",
        txHash: XRPL_TRANSACTION_ID,
        updatedAt: 1n,
      }),
      prepare: vi.fn().mockResolvedValue({
        expiresAt: "2026-08-04T00:01:00.000Z",
        id: REQUEST_ID,
        proofOwner: BORROWER,
        requestBytes: "0x1234",
        requestBytesHash: REQUEST_ID,
        requiredFeeWei: 100n,
        sourceId: "testXRP",
      }),
      recordSubmitted: vi.fn().mockResolvedValue({
        accountId: ACCOUNT_ID,
        attestationRequestTransactionHash: COSTON2_TRANSACTION_ID,
        createdAt: 1n,
        id: REQUEST_ID,
        requestBytesHash: REQUEST_ID,
        status: "SUBMITTED",
        txHash: XRPL_TRANSACTION_ID,
        updatedAt: 2n,
        votingRoundId: 42n,
      }),
      refresh: vi.fn().mockResolvedValue({
        proof: { encodedProof: "0xdead" },
        record: {
          accountId: ACCOUNT_ID,
          createdAt: 1n,
          id: REQUEST_ID,
          requestBytesHash: REQUEST_ID,
          status: "PROOF_READY",
          txHash: XRPL_TRANSACTION_ID,
          updatedAt: 2n,
        },
      }),
    },
    ...overrides,
  };
}

function authenticatedRequest(path: string, body?: unknown): Request {
  return new Request(`https://worker.example${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-reserveflow-address": BORROWER,
      "x-reserveflow-signature": `0x${"11".repeat(65)}`,
      "x-reserveflow-expires-at": "2026-08-04T00:05:00.000Z",
    },
    method: body === undefined ? "GET" : "POST",
  });
}

describe("attestation HTTP API", () => {
  it("prepares an FDC request but never receives a wallet key or submits a transaction", async () => {
    const dependencies = createDependencies();
    const api = createAttestationApi(dependencies);

    const response = await api.handle(
      authenticatedRequest("/attestations/prepare", {
        accountId: ACCOUNT_ID,
        transactionId: XRPL_TRANSACTION_ID,
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      proofOwner: BORROWER,
      requestBytes: "0x1234",
      requiredFeeWei: "100",
    });
    expect(dependencies.coordinator.prepare).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      transactionId: XRPL_TRANSACTION_ID,
    });
    expect(Object.keys(dependencies.coordinator)).not.toContain("submit");
  });

  it("authorizes the registered borrower before exposing or changing an attestation", async () => {
    const dependencies = createDependencies({
      authorize: vi.fn().mockRejectedValue(new Error("Borrower mismatch.")),
    });
    const api = createAttestationApi(dependencies);

    const response = await api.handle(
      authenticatedRequest(`/attestations/${REQUEST_ID}`),
    );

    expect(response.status).toBe(403);
    expect(dependencies.coordinator.refresh).not.toHaveBeenCalled();
  });

  it("records only the user-signed FdcHub transaction hash and returns the fetched proof unchanged", async () => {
    const dependencies = createDependencies();
    const api = createAttestationApi(dependencies);

    const submitted = await api.handle(
      authenticatedRequest(`/attestations/${REQUEST_ID}/submitted`, {
        requestTransactionHash: COSTON2_TRANSACTION_ID,
      }),
    );
    const refreshed = await api.handle(
      authenticatedRequest(`/attestations/${REQUEST_ID}/refresh`, {}),
    );

    expect(submitted.status).toBe(200);
    expect(dependencies.coordinator.recordSubmitted).toHaveBeenCalledWith({
      requestBytesHash: REQUEST_ID,
      requestTransactionHash: COSTON2_TRANSACTION_ID,
    });
    expect(refreshed.status).toBe(200);
    await expect(refreshed.json()).resolves.toMatchObject({
      encodedProof: "0xdead",
      status: "PROOF_READY",
    });
  });

  it("rejects malformed account and transaction IDs before calling the coordinator", async () => {
    const dependencies = createDependencies();
    const api = createAttestationApi(dependencies);

    const response = await api.handle(
      authenticatedRequest("/attestations/prepare", {
        accountId: OTHER_ACCOUNT,
        transactionId: "not-a-transaction",
      }),
    );

    expect(response.status).toBe(400);
    expect(dependencies.coordinator.prepare).not.toHaveBeenCalled();
  });
});
