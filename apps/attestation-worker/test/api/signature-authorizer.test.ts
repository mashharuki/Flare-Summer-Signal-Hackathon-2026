import { asAccountId, asAddress } from "@reserveflow/shared";
import { describe, expect, it, vi } from "vitest";

import { createSignatureAuthorizer } from "../../src/api/signature-authorizer.js";

const ACCOUNT_ID = asAccountId(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const BORROWER = asAddress("0x1111111111111111111111111111111111111111");

function signedRequest(overrides: Record<string, string> = {}): Request {
  return new Request("https://worker.example/attestations/prepare", {
    headers: {
      "x-reserveflow-address": BORROWER,
      "x-reserveflow-expires-at": "2026-08-04T00:05:00.000Z",
      "x-reserveflow-signature": `0x${"11".repeat(65)}`,
      ...overrides,
    },
    method: "POST",
  });
}

describe("signature authorizer", () => {
  it("accepts a current signature from the borrower registered for the reserve account", async () => {
    const verifyMessage = vi.fn().mockResolvedValue(true);
    const authorize = createSignatureAuthorizer({
      getReserveAccount: vi.fn().mockResolvedValue({ borrower: BORROWER }),
      now: () => new Date("2026-08-04T00:00:00.000Z"),
      verifyMessage,
    });

    await expect(
      authorize({ accountId: ACCOUNT_ID, request: signedRequest() }),
    ).resolves.toBeUndefined();
    expect(verifyMessage).toHaveBeenCalledWith(
      expect.objectContaining({ address: BORROWER }),
    );
  });

  it("rejects expired signatures and signatures from any address other than the registered borrower", async () => {
    const authorize = createSignatureAuthorizer({
      getReserveAccount: vi.fn().mockResolvedValue({ borrower: BORROWER }),
      now: () => new Date("2026-08-04T00:00:00.000Z"),
      verifyMessage: vi.fn().mockResolvedValue(true),
    });

    await expect(
      authorize({
        accountId: ACCOUNT_ID,
        request: signedRequest({
          "x-reserveflow-expires-at": "2026-08-03T23:59:59.000Z",
        }),
      }),
    ).rejects.toThrow("expired");
    await expect(
      authorize({
        accountId: ACCOUNT_ID,
        request: signedRequest({
          "x-reserveflow-address": "0x2222222222222222222222222222222222222222",
        }),
      }),
    ).rejects.toThrow("Borrower mismatch");
  });
});
