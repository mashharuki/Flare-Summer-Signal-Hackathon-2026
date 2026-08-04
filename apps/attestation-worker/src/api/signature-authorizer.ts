import {
  type AccountId,
  type Address,
  asAddress,
  createAttestationAuthorizationMessage,
} from "@reserveflow/shared";
import { verifyMessage } from "viem";

import type { AttestationApiAuthorizationInput } from "./attestation-api.js";

export interface SignatureAuthorizerDependencies {
  readonly getReserveAccount: (accountId: AccountId) => Promise<{
    readonly borrower: Address;
  }>;
  readonly now?: () => Date;
  readonly verifyMessage?: typeof verifyMessage;
}

const MAX_SIGNATURE_AGE_MS = 5 * 60_000;

/**
 * Checks a short-lived EIP-191 signature and binds it to the borrower stored
 * in ReserveFlowCore. The worker receives neither a private key nor a wallet.
 */
export function createSignatureAuthorizer(
  dependencies: SignatureAuthorizerDependencies,
): (input: AttestationApiAuthorizationInput) => Promise<void> {
  const now = dependencies.now ?? (() => new Date());
  const verify = dependencies.verifyMessage ?? verifyMessage;
  return async ({ accountId, request }): Promise<void> => {
    const address = parseAddress(request.headers.get("x-reserveflow-address"));
    const signature = parseSignature(
      request.headers.get("x-reserveflow-signature"),
    );
    const expiresAt = parseExpiry(
      request.headers.get("x-reserveflow-expires-at"),
      now(),
    );
    const account = await dependencies.getReserveAccount(accountId);
    if (account.borrower.toLowerCase() !== address.toLowerCase()) {
      throw new Error("Borrower mismatch.");
    }
    const url = new URL(request.url);
    const valid = await verify({
      address: address as `0x${string}`,
      message: createAttestationAuthorizationMessage({
        accountId,
        address,
        expiresAt,
        method: request.method,
        path: url.pathname,
      }),
      signature,
    });
    if (!valid) {
      throw new Error("Invalid attestation API signature.");
    }
  };
}

function parseAddress(value: string | null): Address {
  if (!value) {
    throw new Error("Missing attestation API address.");
  }
  try {
    return asAddress(value);
  } catch {
    throw new Error("Invalid attestation API address.");
  }
}

function parseSignature(value: string | null): `0x${string}` {
  if (!value || !/^0x[0-9a-fA-F]{130}$/.test(value)) {
    throw new Error("Invalid attestation API signature.");
  }
  return value as `0x${string}`;
}

function parseExpiry(value: string | null, now: Date): string {
  if (!value) {
    throw new Error("Missing attestation API signature expiry.");
  }
  const expiry = new Date(value);
  if (Number.isNaN(expiry.getTime())) {
    throw new Error("Invalid attestation API signature expiry.");
  }
  const milliseconds = expiry.getTime() - now.getTime();
  if (milliseconds <= 0) {
    throw new Error("Attestation API signature has expired.");
  }
  if (milliseconds > MAX_SIGNATURE_AGE_MS) {
    throw new Error(
      "Attestation API signature expiry is too far in the future.",
    );
  }
  return expiry.toISOString();
}
