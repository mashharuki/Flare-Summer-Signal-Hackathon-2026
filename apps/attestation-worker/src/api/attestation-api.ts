import {
  type AccountId,
  asAccountId,
  asProofId,
  asTransactionHash,
  type ProofId,
} from "@reserveflow/shared";

import {
  AttestationProgressError,
  type PreparedXrpPaymentAttestation,
  type ProofReadyXrpPaymentAttestation,
  type XrpPaymentAttestationCoordinator,
} from "../fdc/xrp-payment-attestation-coordinator.js";
import type { PersistedAttestationRecord } from "../persistence/attestation-store.js";

export interface AttestationApiAuthorizationInput {
  readonly accountId: AccountId;
  readonly request: Request;
}

export interface AttestationApiCoordinator {
  confirmCoreSubmission(input: {
    readonly requestBytesHash: ProofId;
    readonly transactionHash: ReturnType<typeof asTransactionHash>;
  }): Promise<PersistedAttestationRecord>;
  get(input: {
    readonly requestBytesHash: ProofId;
  }): Promise<PersistedAttestationRecord>;
  prepare(input: {
    readonly accountId: AccountId;
    readonly transactionId: ReturnType<typeof asTransactionHash>;
  }): Promise<PreparedXrpPaymentAttestation>;
  recordSubmitted(input: {
    readonly requestBytesHash: ProofId;
    readonly requestTransactionHash: ReturnType<typeof asTransactionHash>;
  }): Promise<PersistedAttestationRecord>;
  refresh(input: {
    readonly requestBytesHash: ProofId;
  }): Promise<ProofReadyXrpPaymentAttestation>;
}

export interface AttestationApiDependencies {
  /** Validates the signed caller and verifies that it owns `accountId`. */
  readonly authorize: (
    input: AttestationApiAuthorizationInput,
  ) => Promise<void>;
  /** This intentionally exposes no transaction-submission capability. */
  readonly coordinator: AttestationApiCoordinator;
}

export interface AttestationApi {
  handle(request: Request): Promise<Response>;
}

/**
 * Non-custodial HTTP adapter. It only coordinates user-signed transaction
 * hashes. Browser wallets are the sole callers of FdcHub and ReserveFlowCore.
 */
export function createAttestationApi(
  dependencies: AttestationApiDependencies,
): AttestationApi {
  return {
    async handle(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === "/health") {
          return json(200, { status: "ok" });
        }

        if (
          request.method === "POST" &&
          url.pathname === "/attestations/prepare"
        ) {
          const body = await readJson(request);
          const accountId = asAccountId(requiredString(body, "accountId"));
          const transactionId = asTransactionHash(
            requiredString(body, "transactionId"),
          );
          await dependencies.authorize({ accountId, request });
          const prepared = await dependencies.coordinator.prepare({
            accountId,
            transactionId,
          });
          return json(201, serializePrepared(prepared));
        }

        const match =
          /^\/attestations\/(0x[0-9a-fA-F]{64})(?:\/(submitted|refresh|core-submitted))?$/.exec(
            url.pathname,
          );
        if (!match) {
          return json(404, { code: "NOT_FOUND", message: "Route not found." });
        }

        const requestBytesHash = asProofId(match[1] ?? "");
        const action = match[2];
        if (request.method === "GET" && action === undefined) {
          const record = await dependencies.coordinator.get({
            requestBytesHash,
          });
          await dependencies.authorize({
            accountId: record.accountId,
            request,
          });
          return json(200, serializeRecord(record));
        }

        if (request.method !== "POST" || action === undefined) {
          return json(405, {
            code: "METHOD_NOT_ALLOWED",
            message: "Method not allowed.",
          });
        }

        const record = await dependencies.coordinator.get({ requestBytesHash });
        await dependencies.authorize({ accountId: record.accountId, request });
        const body = await readJson(request);
        if (action === "submitted") {
          const submitted = await dependencies.coordinator.recordSubmitted({
            requestBytesHash,
            requestTransactionHash: asTransactionHash(
              requiredString(body, "requestTransactionHash"),
            ),
          });
          return json(200, serializeRecord(submitted));
        }
        if (action === "refresh") {
          const refreshed = await dependencies.coordinator.refresh({
            requestBytesHash,
          });
          return json(200, {
            encodedProof: refreshed.proof.encodedProof,
            ...serializeRecord(refreshed.record),
          });
        }
        const confirmed = await dependencies.coordinator.confirmCoreSubmission({
          requestBytesHash,
          transactionHash: asTransactionHash(
            requiredString(body, "transactionHash"),
          ),
        });
        return json(200, serializeRecord(confirmed));
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

export function asApiCoordinator(
  coordinator: XrpPaymentAttestationCoordinator,
): AttestationApiCoordinator {
  return coordinator;
}

function serializePrepared(value: PreparedXrpPaymentAttestation) {
  return {
    ...value,
    requiredFeeWei: value.requiredFeeWei.toString(),
  };
}

function serializeRecord(value: PersistedAttestationRecord) {
  return {
    ...value,
    ...(value.attestationRequestTransactionHash === undefined
      ? {}
      : {
          attestationRequestTransactionHash:
            value.attestationRequestTransactionHash,
        }),
    ...(value.coreEventTransactionHash === undefined
      ? {}
      : { coreEventTransactionHash: value.coreEventTransactionHash }),
    ...(value.expiresAt === undefined
      ? {}
      : { expiresAt: value.expiresAt.toString() }),
    ...(value.requiredFeeWei === undefined
      ? {}
      : { requiredFeeWei: value.requiredFeeWei.toString() }),
    ...(value.votingRoundId === undefined
      ? {}
      : { votingRoundId: value.votingRoundId.toString() }),
    createdAt: value.createdAt.toString(),
    updatedAt: value.updatedAt.toString(),
  };
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const value: unknown = await request.json();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string.`);
  }
  return value;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

function errorResponse(error: unknown): Response {
  if (error instanceof AttestationProgressError) {
    const status =
      error.code === "NOT_FINALIZED"
        ? 409
        : error.code === "EXPIRED"
          ? 410
          : 503;
    return json(status, { code: error.code, message: error.message });
  }
  const message = error instanceof Error ? error.message : "Unknown API error.";
  const status = /Borrower mismatch|unauthoriz|signature|expired/i.test(message)
    ? 403
    : /not found/i.test(message)
      ? 404
      : 400;
  return json(status, {
    code: status === 403 ? "FORBIDDEN" : "INVALID_REQUEST",
    message,
  });
}
