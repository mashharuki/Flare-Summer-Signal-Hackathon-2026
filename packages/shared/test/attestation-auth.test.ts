import { describe, expect, it } from "vitest";
import { createAttestationAuthorizationMessage } from "../src/attestation-auth.js";
import { asAccountId, asAddress } from "../src/domain.js";

describe("attestation API authorization message", () => {
  it("binds a signature to the Coston2 account, request path, and expiry", () => {
    expect(
      createAttestationAuthorizationMessage({
        accountId: asAccountId(
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ),
        address: asAddress("0x1111111111111111111111111111111111111111"),
        expiresAt: "2026-08-04T00:05:00.000Z",
        method: "POST",
        path: "/attestations/prepare",
      }),
    ).toBe(
      `ReserveFlow Attestation API\nchainId: 114\naddress: 0x1111111111111111111111111111111111111111\naccountId: 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nmethod: POST\npath: /attestations/prepare\nexpiresAt: 2026-08-04T00:05:00.000Z`,
    );
  });
});
