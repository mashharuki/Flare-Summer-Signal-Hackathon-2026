import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  type AccountId,
  type Address,
  type AttestationFailure,
  type AttestationRecord,
  type AttestationStatus,
  asAccountId,
  asAddress,
  asProofId,
  asTransactionHash,
  type DomainErrorCode,
  type ProofId,
  type TransactionHash,
} from "@reserveflow/shared";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

const ATTESTATION_STATUSES: readonly AttestationStatus[] = [
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

const DOMAIN_ERROR_CODES: readonly DomainErrorCode[] = [
  "CREDIT_NOT_HEALTHY",
  "CREDIT_LIMIT_EXCEEDED",
  "STALE_PRICE",
  "STALE_RESERVE",
  "BORROWING_PAUSED",
  "ZERO_AMOUNT",
  "EXCESS_REPAYMENT",
  "INSUFFICIENT_RFUSD_ALLOWANCE",
  "INSUFFICIENT_RFUSD_BALANCE",
  "RFUSD_TRANSFER_FAILED",
  "INVALID_XRPL_ADDRESS",
  "INVALID_AMOUNT",
  "NOT_FINALIZED",
  "DA_UNAVAILABLE",
  "INVALID_FDC_PROOF",
  "FDC_FEE_UNAVAILABLE",
  "INSUFFICIENT_C2FLR_FEE",
  "PROOF_ALREADY_USED",
  "PROOF_OWNER_MISMATCH",
  "OUT_OF_ORDER_LEDGER",
  "ACCOUNT_FROZEN",
];

const NON_TERMINAL_STATUSES: readonly AttestationStatus[] = [
  "PREPARING",
  "READY_TO_SUBMIT",
  "SUBMITTED",
  "WAITING_FINALIZATION",
  "FETCHING_PROOF",
  "PROOF_READY",
];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS attestation_records (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    request_bytes_hash TEXT UNIQUE NOT NULL,
    request_bytes TEXT,
    proof_owner TEXT,
    required_fee_wei TEXT,
    expires_at TEXT,
    attestation_request_tx_hash TEXT,
    voting_round_id TEXT,
    status TEXT NOT NULL,
    failure_code TEXT,
    failure_message TEXT,
    core_event_tx_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

type SqliteRow = Readonly<Record<string, unknown>>;

export interface CreateAttestationRecordInput {
  readonly accountId: AccountId;
  readonly expiresAt?: bigint;
  readonly id: ProofId;
  readonly proofOwner?: Address;
  readonly requestBytes?: `0x${string}`;
  readonly requestBytesHash: ProofId;
  readonly requiredFeeWei?: bigint;
  readonly txHash: TransactionHash;
}

export interface PersistedAttestationRecord extends AttestationRecord {
  readonly attestationRequestTransactionHash?: TransactionHash;
  readonly coreEventTransactionHash?: TransactionHash;
  readonly expiresAt?: bigint;
  readonly proofOwner?: Address;
  readonly requestBytes?: `0x${string}`;
  readonly requiredFeeWei?: bigint;
}

export interface SqliteAttestationStoreOptions {
  readonly databasePath: string;
}

/**
 * Stores only resumable FDC progress. Reserve balances, debt, and credit state
 * remain on-chain and are deliberately absent from this schema.
 */
export class SqliteAttestationStore {
  private closed = false;

  public constructor(
    public readonly databasePath: string,
    private readonly database: Database,
  ) {}

  public async createOrGetPrepared(
    input: CreateAttestationRecordInput,
  ): Promise<PersistedAttestationRecord> {
    this.assertOpen();
    const timestamp = this.now();
    this.database.run(
      `INSERT OR IGNORE INTO attestation_records (
        id, account_id, tx_hash, request_bytes_hash, request_bytes, proof_owner,
        required_fee_wei, expires_at, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.accountId,
        input.txHash,
        input.requestBytesHash,
        input.requestBytes ?? null,
        input.proofOwner ?? null,
        input.requiredFeeWei?.toString() ?? null,
        input.expiresAt?.toString() ?? null,
        "READY_TO_SUBMIT",
        timestamp,
        timestamp,
      ],
    );
    if (this.database.getRowsModified() > 0) {
      await this.persist();
    }
    return this.requireRecord(input.requestBytesHash);
  }

  public async getByRequestBytesHash(
    requestBytesHash: ProofId,
  ): Promise<PersistedAttestationRecord | undefined> {
    this.assertOpen();
    return this.getRecord(requestBytesHash);
  }

  public async markSubmitted(
    requestBytesHash: ProofId,
    input: {
      readonly requestTransactionHash: TransactionHash;
      readonly votingRoundId: bigint;
    },
  ): Promise<PersistedAttestationRecord> {
    return this.transition(requestBytesHash, "SUBMITTED", ["READY_TO_SUBMIT"], {
      attestationRequestTransactionHash: input.requestTransactionHash,
      votingRoundId: input.votingRoundId,
    });
  }

  public async markWaitingForFinalization(
    requestBytesHash: ProofId,
  ): Promise<PersistedAttestationRecord> {
    return this.transition(requestBytesHash, "WAITING_FINALIZATION", [
      "SUBMITTED",
    ]);
  }

  public async markFetchingProof(
    requestBytesHash: ProofId,
  ): Promise<PersistedAttestationRecord> {
    return this.transition(requestBytesHash, "FETCHING_PROOF", [
      "WAITING_FINALIZATION",
    ]);
  }

  public async markProofReady(
    requestBytesHash: ProofId,
  ): Promise<PersistedAttestationRecord> {
    return this.transition(requestBytesHash, "PROOF_READY", ["FETCHING_PROOF"]);
  }

  public async markVerified(_requestBytesHash: ProofId): Promise<never> {
    throw new Error(
      "VERIFIED must be recorded from a ReserveFlowCore completion event.",
    );
  }

  public async markVerifiedFromCoreEvent(
    requestBytesHash: ProofId,
    input: { readonly transactionHash: TransactionHash },
  ): Promise<PersistedAttestationRecord> {
    return this.transition(requestBytesHash, "VERIFIED", ["PROOF_READY"], {
      coreEventTransactionHash: input.transactionHash,
    });
  }

  public async markFailed(
    requestBytesHash: ProofId,
    failure: AttestationFailure,
  ): Promise<PersistedAttestationRecord> {
    return this.transition(requestBytesHash, "FAILED", NON_TERMINAL_STATUSES, {
      failure,
    });
  }

  public async markExpired(
    requestBytesHash: ProofId,
  ): Promise<PersistedAttestationRecord> {
    return this.transition(requestBytesHash, "EXPIRED", NON_TERMINAL_STATUSES);
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    await this.persist();
    this.database.close();
    this.closed = true;
  }

  private async transition(
    requestBytesHash: ProofId,
    status: AttestationStatus,
    allowedPreviousStatuses: readonly AttestationStatus[],
    details: {
      readonly attestationRequestTransactionHash?: TransactionHash;
      readonly coreEventTransactionHash?: TransactionHash;
      readonly failure?: AttestationFailure;
      readonly votingRoundId?: bigint;
    } = {},
  ): Promise<PersistedAttestationRecord> {
    this.assertOpen();
    const record = this.requireRecord(requestBytesHash);
    if (record.status === status) {
      return record;
    }
    if (!allowedPreviousStatuses.includes(record.status)) {
      throw new Error(
        `Cannot transition attestation ${requestBytesHash} from ${record.status} to ${status}.`,
      );
    }

    this.database.run(
      `UPDATE attestation_records
       SET status = ?,
           attestation_request_tx_hash = COALESCE(?, attestation_request_tx_hash),
           voting_round_id = COALESCE(?, voting_round_id),
           failure_code = ?,
           failure_message = ?,
           core_event_tx_hash = COALESCE(?, core_event_tx_hash),
           updated_at = ?
       WHERE request_bytes_hash = ?`,
      [
        status,
        details.attestationRequestTransactionHash ?? null,
        details.votingRoundId?.toString() ?? null,
        details.failure?.code ?? null,
        details.failure?.message ?? null,
        details.coreEventTransactionHash ?? null,
        this.now(),
        requestBytesHash,
      ],
    );
    await this.persist();
    return this.requireRecord(requestBytesHash);
  }

  private getRecord(
    requestBytesHash: ProofId,
  ): PersistedAttestationRecord | undefined {
    const statement = this.database.prepare(
      "SELECT * FROM attestation_records WHERE request_bytes_hash = ?",
      [requestBytesHash],
    );
    try {
      if (!statement.step()) {
        return undefined;
      }
      return this.toRecord(statement.getAsObject());
    } finally {
      statement.free();
    }
  }

  private requireRecord(requestBytesHash: ProofId): PersistedAttestationRecord {
    const record = this.getRecord(requestBytesHash);
    if (!record) {
      throw new Error(`Attestation record not found for ${requestBytesHash}.`);
    }
    return record;
  }

  private toRecord(row: SqliteRow): PersistedAttestationRecord {
    const failureCode = nullableString(row.failure_code);
    const failureMessage = nullableString(row.failure_message);
    if ((failureCode === undefined) !== (failureMessage === undefined)) {
      throw new Error("Attestation record has an incomplete failure payload.");
    }

    const requestTransactionHash = nullableString(
      row.attestation_request_tx_hash,
    );
    const coreEventTransactionHash = nullableString(row.core_event_tx_hash);
    const expiresAt = nullableString(row.expires_at);
    const proofOwner = nullableString(row.proof_owner);
    const requestBytes = nullableString(row.request_bytes);
    const requiredFeeWei = nullableString(row.required_fee_wei);
    const votingRoundId = nullableString(row.voting_round_id);
    return {
      accountId: asAccountId(requiredString(row.account_id, "account_id")),
      ...(requestTransactionHash === undefined
        ? {}
        : {
            attestationRequestTransactionHash: asTransactionHash(
              requestTransactionHash,
            ),
          }),
      createdAt: BigInt(requiredString(row.created_at, "created_at")),
      ...(coreEventTransactionHash === undefined
        ? {}
        : {
            coreEventTransactionHash: asTransactionHash(
              coreEventTransactionHash,
            ),
          }),
      ...(expiresAt === undefined ? {} : { expiresAt: BigInt(expiresAt) }),
      ...(failureCode === undefined || failureMessage === undefined
        ? {}
        : {
            failure: {
              code: asDomainErrorCode(failureCode),
              message: failureMessage,
            },
          }),
      id: asProofId(requiredString(row.id, "id")),
      ...(proofOwner === undefined
        ? {}
        : { proofOwner: asAddress(proofOwner) }),
      ...(requestBytes === undefined
        ? {}
        : { requestBytes: asRequestBytes(requestBytes) }),
      requestBytesHash: asProofId(
        requiredString(row.request_bytes_hash, "request_bytes_hash"),
      ),
      ...(requiredFeeWei === undefined
        ? {}
        : { requiredFeeWei: BigInt(requiredFeeWei) }),
      status: asAttestationStatus(requiredString(row.status, "status")),
      txHash: asTransactionHash(requiredString(row.tx_hash, "tx_hash")),
      updatedAt: BigInt(requiredString(row.updated_at, "updated_at")),
      ...(votingRoundId === undefined
        ? {}
        : { votingRoundId: BigInt(votingRoundId) }),
    };
  }

  private async persist(): Promise<void> {
    const temporaryPath = `${this.databasePath}.tmp`;
    await writeFile(temporaryPath, this.database.export());
    await rename(temporaryPath, this.databasePath);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("Attestation store is closed.");
    }
  }

  private now(): string {
    return Date.now().toString();
  }
}

export async function createSqliteAttestationStore(
  options: SqliteAttestationStoreOptions,
): Promise<SqliteAttestationStore> {
  await mkdir(dirname(options.databasePath), { recursive: true });
  const sql = await initSqlJs();
  const database = new sql.Database(await readDatabase(options.databasePath));
  migrate(database);
  const store = new SqliteAttestationStore(options.databasePath, database);
  await store.close();
  return createOpenedStore(options.databasePath, sql);
}

function migrate(database: Database): void {
  database.run(SCHEMA);
  const existingColumns = new Set(
    database
      .exec("PRAGMA table_info(attestation_records)")[0]
      ?.values.map((row) => row[1])
      .filter((value): value is string => typeof value === "string") ?? [],
  );
  for (const [name, definition] of [
    ["request_bytes", "TEXT"],
    ["proof_owner", "TEXT"],
    ["required_fee_wei", "TEXT"],
    ["expires_at", "TEXT"],
  ] as const) {
    if (!existingColumns.has(name)) {
      database.run(
        `ALTER TABLE attestation_records ADD COLUMN ${name} ${definition}`,
      );
    }
  }
}

async function createOpenedStore(
  databasePath: string,
  sql: SqlJsStatic,
): Promise<SqliteAttestationStore> {
  const database = new sql.Database(await readDatabase(databasePath));
  return new SqliteAttestationStore(databasePath, database);
}

async function readDatabase(
  databasePath: string,
): Promise<Uint8Array | undefined> {
  try {
    return await readFile(databasePath);
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function requiredString(value: unknown, column: string): string {
  if (typeof value !== "string") {
    throw new Error(`Attestation record column ${column} must be text.`);
  }
  return value;
}

function nullableString(value: unknown): string | undefined {
  if (value === null) {
    return undefined;
  }
  return requiredString(value, "nullable column");
}

function asRequestBytes(value: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error("Attestation request bytes must be hexadecimal.");
  }
  return value as `0x${string}`;
}

function asAttestationStatus(value: string): AttestationStatus {
  if (!ATTESTATION_STATUSES.includes(value as AttestationStatus)) {
    throw new Error(`Unknown attestation status: ${value}.`);
  }
  return value as AttestationStatus;
}

function asDomainErrorCode(value: string): DomainErrorCode {
  if (!DOMAIN_ERROR_CODES.includes(value as DomainErrorCode)) {
    throw new Error(`Unknown attestation failure code: ${value}.`);
  }
  return value as DomainErrorCode;
}
