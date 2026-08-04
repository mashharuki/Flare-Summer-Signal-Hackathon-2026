import type { AccountId, Address } from "./domain.js";

export interface AttestationAuthorizationMessageInput {
  readonly accountId: AccountId;
  readonly address: Address;
  readonly expiresAt: string;
  readonly method: string;
  readonly path: string;
}

/**
 * Canonical, human-readable message for the off-chain API session. It never
 * grants token approval or transaction-signing authority.
 */
export function createAttestationAuthorizationMessage(
  input: AttestationAuthorizationMessageInput,
): string {
  return [
    "ReserveFlow Attestation API",
    "chainId: 114",
    `address: ${input.address}`,
    `accountId: ${input.accountId}`,
    `method: ${input.method.toUpperCase()}`,
    `path: ${input.path}`,
    `expiresAt: ${input.expiresAt}`,
  ].join("\n");
}
