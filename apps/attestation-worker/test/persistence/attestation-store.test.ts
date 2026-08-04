import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asAccountId, asProofId, asTransactionHash } from "@reserveflow/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  createSqliteAttestationStore,
  type SqliteAttestationStore,
} from "../../src/persistence/attestation-store.js";

const ACCOUNT_ID = asAccountId(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const REQUEST_BYTES_HASH = asProofId(
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
);
const TX_HASH = asTransactionHash(
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
);
const FDC_REQUEST_TX_HASH = asProofId(
  "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
);
const CORE_EVENT_TX_HASH = asTransactionHash(
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
);

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function openStore(): Promise<SqliteAttestationStore> {
  const directory = await mkdtemp(join(tmpdir(), "reserveflow-attestation-"));
  temporaryDirectories.push(directory);
  return createSqliteAttestationStore({
    databasePath: join(directory, "attestations.sqlite"),
  });
}

function createRecordInput() {
  return {
    accountId: ACCOUNT_ID,
    id: REQUEST_BYTES_HASH,
    requestBytesHash: REQUEST_BYTES_HASH,
    txHash: TX_HASH,
  } as const;
}

describe("SqliteAttestationStore", () => {
  it("persists one prepared record per request bytes hash and resumes it after restart", async () => {
    const store = await openStore();
    const created = await store.createOrGetPrepared(createRecordInput());
    const sameRequest = await store.createOrGetPrepared({
      ...createRecordInput(),
      id: asProofId(TX_HASH),
    });

    expect(created.status).toBe("READY_TO_SUBMIT");
    expect(sameRequest).toEqual(created);
    await store.close();

    const resumed = await createSqliteAttestationStore({
      databasePath: store.databasePath,
    });
    await expect(
      resumed.getByRequestBytesHash(REQUEST_BYTES_HASH),
    ).resolves.toEqual(created);
    await expect(readFile(store.databasePath)).resolves.toSatisfy(
      (contents) =>
        contents.subarray(0, 15).toString("ascii") === "SQLite format 3",
    );
    await resumed.close();
  });

  it("keeps finalization progress durable while repeated refreshes return the same record", async () => {
    const store = await openStore();
    await store.createOrGetPrepared(createRecordInput());
    await store.markSubmitted(REQUEST_BYTES_HASH, {
      requestTransactionHash: asTransactionHash(FDC_REQUEST_TX_HASH),
      votingRoundId: 1415332n,
    });
    const waiting = await store.markWaitingForFinalization(REQUEST_BYTES_HASH);
    const repeatedRefresh =
      await store.markWaitingForFinalization(REQUEST_BYTES_HASH);

    expect(waiting).toEqual(repeatedRefresh);
    expect(waiting.status).toBe("WAITING_FINALIZATION");
    expect(waiting.votingRoundId).toBe(1415332n);
    await store.close();

    const resumed = await createSqliteAttestationStore({
      databasePath: store.databasePath,
    });
    await expect(
      resumed.getByRequestBytesHash(REQUEST_BYTES_HASH),
    ).resolves.toMatchObject({
      status: "WAITING_FINALIZATION",
      votingRoundId: 1415332n,
    });
    await resumed.close();
  });

  it("sets VERIFIED only from a ReserveFlowCore completion event", async () => {
    const store = await openStore();
    await store.createOrGetPrepared(createRecordInput());
    await store.markSubmitted(REQUEST_BYTES_HASH, {
      requestTransactionHash: asTransactionHash(FDC_REQUEST_TX_HASH),
      votingRoundId: 1415332n,
    });
    await store.markWaitingForFinalization(REQUEST_BYTES_HASH);
    await store.markFetchingProof(REQUEST_BYTES_HASH);
    await store.markProofReady(REQUEST_BYTES_HASH);

    await expect(store.markVerified(REQUEST_BYTES_HASH)).rejects.toThrow(
      "ReserveFlowCore completion event",
    );

    const verified = await store.markVerifiedFromCoreEvent(REQUEST_BYTES_HASH, {
      transactionHash: CORE_EVENT_TX_HASH,
    });
    expect(verified.status).toBe("VERIFIED");
    expect(verified.coreEventTransactionHash).toBe(CORE_EVENT_TX_HASH);
    await store.close();
  });

  it("records failure and expiration without storing financial state", async () => {
    const store = await openStore();
    await store.createOrGetPrepared(createRecordInput());

    const failed = await store.markFailed(REQUEST_BYTES_HASH, {
      code: "DA_UNAVAILABLE",
      message: "DA Layer did not return a proof.",
    });
    expect(failed).toMatchObject({
      failure: { code: "DA_UNAVAILABLE" },
      status: "FAILED",
    });

    const second = await store.createOrGetPrepared({
      ...createRecordInput(),
      id: FDC_REQUEST_TX_HASH,
      requestBytesHash: FDC_REQUEST_TX_HASH,
    });
    const expired = await store.markExpired(second.requestBytesHash);
    expect(expired.status).toBe("EXPIRED");
    await store.close();
  });
});
