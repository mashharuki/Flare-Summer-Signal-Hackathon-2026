import {
  asAccountId,
  asAddress,
  asProofId,
  asTransactionHash,
} from "@reserveflow/shared";
import { describe, expect, it, vi } from "vitest";

import { createAttestationApiClient } from "../src/attestation-api-client.js";

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

describe("attestation API client", () => {
  it("signs a short-lived message for the exact endpoint and parses fee values without Number conversion", async () => {
    const signMessage = vi.fn().mockResolvedValue(`0x${"11".repeat(65)}`);
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        expiresAt: "2026-08-04T00:05:00.000Z",
        id: REQUEST_ID,
        proofOwner: BORROWER,
        requestBytes: "0x1234",
        requestBytesHash: REQUEST_ID,
        requiredFeeWei: "1000000000000000001",
        sourceId: "testXRP",
      }),
    );
    const client = createAttestationApiClient({
      address: BORROWER,
      accountId: ACCOUNT_ID,
      baseUrl: "https://worker.example/",
      fetcher,
      now: () => new Date("2026-08-04T00:00:00.000Z"),
      signMessage,
    });

    const prepared = await client.prepare({
      accountId: ACCOUNT_ID,
      transactionId: XRPL_TRANSACTION_ID,
    });

    expect(prepared.requiredFeeWei).toBe(1_000_000_000_000_000_001n);
    expect(signMessage).toHaveBeenCalledWith(
      expect.stringContaining("path: /attestations/prepare"),
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://worker.example/attestations/prepare",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("turns non-success API responses into recoverable errors", async () => {
    const client = createAttestationApiClient({
      address: BORROWER,
      accountId: ACCOUNT_ID,
      baseUrl: "https://worker.example",
      fetcher: vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code: "NOT_FINALIZED", message: "Wait for FDC." },
            { status: 409 },
          ),
        ),
      signMessage: vi.fn().mockResolvedValue(`0x${"11".repeat(65)}`),
    });

    await expect(
      client.refresh({ requestBytesHash: REQUEST_ID }),
    ).rejects.toThrow("Wait for FDC");
  });
});
