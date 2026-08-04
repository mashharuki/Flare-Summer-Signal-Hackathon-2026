import {
  type AccountId,
  type Address,
  type AttestationStatus,
  asAddress,
  asProofId,
  createAttestationAuthorizationMessage,
} from "@reserveflow/shared";

import type {
  AttestationApiClient,
  PreparedAttestation,
} from "./attestation-flow.js";

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class AttestationApiError extends Error {
  public constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AttestationApiError";
  }
}

export interface AttestationApiClientOptions {
  readonly accountId: AccountId;
  readonly address: Address;
  readonly baseUrl: string;
  readonly fetcher?: Fetcher;
  readonly now?: () => Date;
  readonly signMessage: (message: string) => Promise<`0x${string}`>;
}

/** Browser-only client. It authorizes API reads with a wallet signature only. */
export function createAttestationApiClient(
  options: AttestationApiClientOptions,
): AttestationApiClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const call = async (
    path: string,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<unknown> => {
    const expiresAt = new Date(now().getTime() + 5 * 60_000).toISOString();
    const signature = await options.signMessage(
      createAttestationAuthorizationMessage({
        accountId: options.accountId,
        address: options.address,
        expiresAt,
        method,
        path,
      }),
    );
    const response = await fetcher(`${baseUrl}${path}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        "x-reserveflow-address": options.address,
        "x-reserveflow-expires-at": expiresAt,
        "x-reserveflow-signature": signature,
      },
      method,
    });
    const payload = await readPayload(response);
    if (!response.ok) {
      throw new AttestationApiError(
        stringField(payload, "code") ?? "API_ERROR",
        response.status,
        stringField(payload, "message") ?? "Attestation API request failed.",
      );
    }
    return payload;
  };

  return {
    async confirmCoreSubmission({ requestBytesHash, transactionHash }) {
      return asStatusRecord(
        await call(`/attestations/${requestBytesHash}/core-submitted`, "POST", {
          transactionHash,
        }),
      );
    },
    async prepare({ accountId, transactionId, purpose, contextId }) {
      if (accountId !== options.accountId) {
        throw new Error(
          "Attestation API account does not match the connected borrower session.",
        );
      }
      return asPrepared(
        await call("/attestations/prepare", "POST", {
          accountId,
          transactionId,
          ...(purpose === undefined ? {} : { purpose }),
          ...(contextId === undefined ? {} : { contextId }),
        }),
      );
    },
    async recordSubmitted({ requestBytesHash, requestTransactionHash }) {
      return asStatusRecord(
        await call(`/attestations/${requestBytesHash}/submitted`, "POST", {
          requestTransactionHash,
        }),
      );
    },
    async refresh({ requestBytesHash }) {
      const payload = objectPayload(
        await call(`/attestations/${requestBytesHash}/refresh`, "POST", {}),
      );
      const status = asStatus(requiredString(payload, "status"));
      const encodedProof = stringField(payload, "encodedProof");
      if (status === "PROOF_READY") {
        if (!encodedProof || !/^0x[0-9a-fA-F]*$/.test(encodedProof)) {
          throw new Error(
            "Worker returned PROOF_READY without an encoded FDC proof.",
          );
        }
        return { encodedProof: encodedProof as `0x${string}`, status };
      }
      return { status };
    },
  };
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Attestation Worker URL must use HTTP(S).");
  }
  return url.origin;
}

async function readPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function objectPayload(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Attestation API returned an invalid JSON object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: Record<string, unknown>, name: string): string {
  const field = stringField(value, name);
  if (!field) {
    throw new Error(`Attestation API response is missing ${name}.`);
  }
  return field;
}

function stringField(value: unknown, name: string): string | undefined {
  if (typeof value !== "object" || value === null || !(name in value)) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[name];
  return typeof field === "string" ? field : undefined;
}

function asPrepared(value: unknown): PreparedAttestation {
  const payload = objectPayload(value);
  const requestBytes = requiredString(payload, "requestBytes");
  if (!/^0x[0-9a-fA-F]*$/.test(requestBytes)) {
    throw new Error("Attestation API returned invalid request bytes.");
  }
  const fee = requiredString(payload, "requiredFeeWei");
  if (!/^\d+$/.test(fee)) {
    throw new Error("Attestation API returned an invalid FDC fee.");
  }
  return {
    id: asProofId(requiredString(payload, "id")),
    proofOwner: asAddress(requiredString(payload, "proofOwner")),
    requestBytes: requestBytes as `0x${string}`,
    requestBytesHash: asProofId(requiredString(payload, "requestBytesHash")),
    requiredFeeWei: BigInt(fee),
  };
}

function asStatusRecord(value: unknown): { readonly status: string } {
  return { status: requiredString(objectPayload(value), "status") };
}

function asStatus(value: string): AttestationStatus {
  const statuses: readonly AttestationStatus[] = [
    "PREPARING",
    "READY_TO_SUBMIT",
    "SUBMITTED",
    "WAITING_FINALIZATION",
    "FETCHING_PROOF",
    "PROOF_READY",
    "VERIFIED",
    "FAILED",
    "EXPIRED",
  ];
  if (!statuses.includes(value as AttestationStatus)) {
    throw new Error("Attestation API returned an unknown status.");
  }
  return value as AttestationStatus;
}
