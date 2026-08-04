import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  asAccountId,
  asAddress,
  asProofId,
  asTransactionHash,
} from "@reserveflow/shared";
import { type Hex, keccak256 } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  XrpPaymentAttestationCoordinator,
  type XrpPaymentAttestationCoordinatorDependencies,
} from "../../src/fdc/xrp-payment-attestation-coordinator.js";
import { createSqliteAttestationStore } from "../../src/persistence/attestation-store.js";

const ACCOUNT_ID = asAccountId(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const BORROWER = asAddress("0x1111111111111111111111111111111111111111");
const FDC_HUB = asAddress("0x2222222222222222222222222222222222222222");
const XRPL_TRANSACTION_ID = asTransactionHash(
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
);
const REQUEST_TRANSACTION_HASH = asTransactionHash(
  "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
);
const CORE_SUBMISSION_TRANSACTION_HASH = asTransactionHash(
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
);
const REQUEST_BYTES = "0x1234" as Hex;
const REQUEST_BYTES_HASH = asProofId(keccak256(REQUEST_BYTES));
const NOW = new Date("2026-08-04T00:00:00.000Z");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createCoordinator(
  overrides: Partial<XrpPaymentAttestationCoordinatorDependencies> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "reserveflow-coordinator-"));
  temporaryDirectories.push(directory);
  const store = await createSqliteAttestationStore({
    databasePath: join(directory, "attestations.sqlite"),
  });
  const dependencies: XrpPaymentAttestationCoordinatorDependencies = {
    accountReader: {
      getReserveAccount: vi.fn().mockResolvedValue({
        borrower: BORROWER,
        sourceId: "testXRP",
      }),
    },
    fdcHub: {
      address: FDC_HUB,
      getRequestFee: vi.fn().mockResolvedValue(100n),
      getRequestReceipt: vi.fn().mockResolvedValue({
        blockTimestamp: 190n,
        chainId: 114,
        paidFeeWei: 100n,
        requestBytes: REQUEST_BYTES,
        status: "success",
        to: FDC_HUB,
      }),
      getVotingRoundParameters: vi.fn().mockResolvedValue({
        firstVotingRoundStartTimestamp: 100n,
        votingEpochDurationSeconds: 30n,
      }),
    },
    coreEvents: {
      getProofSubmissionOutcome: vi.fn().mockResolvedValue({
        kind: "VERIFIED",
      }),
    },
    now: () => NOW,
    proofGateway: {
      getXrpPaymentProof: vi.fn().mockResolvedValue({
        encodedProof: "0xdead" as Hex,
      }),
      isRoundFinalized: vi.fn().mockResolvedValue(true),
    },
    requestTtlMilliseconds: 60_000,
    store,
    verifier: {
      prepareXrpPayment: vi.fn().mockResolvedValue({
        requestBytes: REQUEST_BYTES,
      }),
    },
    ...overrides,
  };
  return {
    coordinator: new XrpPaymentAttestationCoordinator(dependencies),
    dependencies,
    store,
  };
}

describe("XrpPaymentAttestationCoordinator", () => {
  it("derives proof owner from the registered testXRP reserve account and returns the dynamic fee", async () => {
    const { coordinator, dependencies, store } = await createCoordinator();

    const prepared = await coordinator.prepare({
      accountId: ACCOUNT_ID,
      transactionId: XRPL_TRANSACTION_ID,
    });

    expect(dependencies.verifier.prepareXrpPayment).toHaveBeenCalledWith({
      proofOwner: BORROWER,
      sourceId: "testXRP",
      transactionId: XRPL_TRANSACTION_ID,
    });
    expect(dependencies.fdcHub.getRequestFee).toHaveBeenCalledWith(
      REQUEST_BYTES,
    );
    expect(prepared).toEqual({
      expiresAt: "2026-08-04T00:01:00.000Z",
      id: REQUEST_BYTES_HASH,
      proofOwner: BORROWER,
      requestBytes: REQUEST_BYTES,
      requestBytesHash: REQUEST_BYTES_HASH,
      requiredFeeWei: 100n,
      sourceId: "testXRP",
    });
    await expect(
      store.getByRequestBytesHash(REQUEST_BYTES_HASH),
    ).resolves.toMatchObject({
      proofOwner: BORROWER,
      requestBytes: REQUEST_BYTES,
      requiredFeeWei: 100n,
    });
    await store.close();
  });

  it("rejects a reserve account outside the testXRP MVP scope before contacting the verifier", async () => {
    const { coordinator, dependencies, store } = await createCoordinator({
      accountReader: {
        getReserveAccount: vi.fn().mockResolvedValue({
          borrower: BORROWER,
          sourceId: "XRP",
        }),
      },
    });

    await expect(
      coordinator.prepare({
        accountId: ACCOUNT_ID,
        transactionId: XRPL_TRANSACTION_ID,
      }),
    ).rejects.toThrow("testXRP");
    expect(dependencies.verifier.prepareXrpPayment).not.toHaveBeenCalled();
    await store.close();
  });

  it("verifies the Web receipt and derives the voting round without accepting a client round id", async () => {
    const { coordinator, dependencies, store } = await createCoordinator();
    await coordinator.prepare({
      accountId: ACCOUNT_ID,
      transactionId: XRPL_TRANSACTION_ID,
    });

    const submitted = await coordinator.recordSubmitted({
      requestBytesHash: REQUEST_BYTES_HASH,
      requestTransactionHash: REQUEST_TRANSACTION_HASH,
    });

    expect(dependencies.fdcHub.getVotingRoundParameters).toHaveBeenCalledOnce();
    expect(submitted).toMatchObject({
      attestationRequestTransactionHash: REQUEST_TRANSACTION_HASH,
      status: "SUBMITTED",
      votingRoundId: 3n,
    });
    await store.close();
  });

  it("rejects a receipt with mismatched request bytes or fee without changing the stored state", async () => {
    const { coordinator, dependencies, store } = await createCoordinator({
      fdcHub: {
        address: FDC_HUB,
        getRequestFee: vi.fn().mockResolvedValue(100n),
        getRequestReceipt: vi.fn().mockResolvedValue({
          blockTimestamp: 190n,
          chainId: 114,
          paidFeeWei: 99n,
          requestBytes:
            "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as Hex,
          status: "success",
          to: FDC_HUB,
        }),
        getVotingRoundParameters: vi.fn(),
      },
    });
    await coordinator.prepare({
      accountId: ACCOUNT_ID,
      transactionId: XRPL_TRANSACTION_ID,
    });

    await expect(
      coordinator.recordSubmitted({
        requestBytesHash: REQUEST_BYTES_HASH,
        requestTransactionHash: REQUEST_TRANSACTION_HASH,
      }),
    ).rejects.toThrow("do not match");
    await expect(
      store.getByRequestBytesHash(REQUEST_BYTES_HASH),
    ).resolves.toMatchObject({ status: "READY_TO_SUBMIT" });
    expect(dependencies.fdcHub.getVotingRoundParameters).not.toHaveBeenCalled();
    await store.close();
  });

  it("rejects an underpaid FdcHub receipt without recording a submission", async () => {
    const { coordinator, dependencies, store } = await createCoordinator({
      fdcHub: {
        address: FDC_HUB,
        getRequestFee: vi.fn().mockResolvedValue(100n),
        getRequestReceipt: vi.fn().mockResolvedValue({
          blockTimestamp: 190n,
          chainId: 114,
          paidFeeWei: 99n,
          requestBytes: REQUEST_BYTES,
          status: "success",
          to: FDC_HUB,
        }),
        getVotingRoundParameters: vi.fn(),
      },
    });
    await coordinator.prepare({
      accountId: ACCOUNT_ID,
      transactionId: XRPL_TRANSACTION_ID,
    });

    await expect(
      coordinator.recordSubmitted({
        requestBytesHash: REQUEST_BYTES_HASH,
        requestTransactionHash: REQUEST_TRANSACTION_HASH,
      }),
    ).rejects.toThrow("required C2FLR fee");
    await expect(
      store.getByRequestBytesHash(REQUEST_BYTES_HASH),
    ).resolves.toMatchObject({ status: "READY_TO_SUBMIT" });
    expect(dependencies.fdcHub.getVotingRoundParameters).not.toHaveBeenCalled();
    await store.close();
  });

  it("keeps an attestation waiting and reports NOT_FINALIZED before Relay finalization", async () => {
    const { coordinator, dependencies, store } = await createCoordinator({
      proofGateway: {
        getXrpPaymentProof: vi.fn(),
        isRoundFinalized: vi.fn().mockResolvedValue(false),
      },
    });
    await coordinator.prepare({
      accountId: ACCOUNT_ID,
      transactionId: XRPL_TRANSACTION_ID,
    });
    await coordinator.recordSubmitted({
      requestBytesHash: REQUEST_BYTES_HASH,
      requestTransactionHash: REQUEST_TRANSACTION_HASH,
    });

    await expect(
      coordinator.refresh({ requestBytesHash: REQUEST_BYTES_HASH }),
    ).rejects.toMatchObject({ code: "NOT_FINALIZED" });
    await expect(
      store.getByRequestBytesHash(REQUEST_BYTES_HASH),
    ).resolves.toMatchObject({ status: "WAITING_FINALIZATION" });
    expect(dependencies.proofGateway.getXrpPaymentProof).not.toHaveBeenCalled();
    await store.close();
  });

  it("returns the opaque DA proof only after finalization and records PROOF_READY", async () => {
    const { coordinator, dependencies, store } = await createCoordinator();
    await coordinator.prepare({
      accountId: ACCOUNT_ID,
      transactionId: XRPL_TRANSACTION_ID,
    });
    await coordinator.recordSubmitted({
      requestBytesHash: REQUEST_BYTES_HASH,
      requestTransactionHash: REQUEST_TRANSACTION_HASH,
    });

    const proofReady = await coordinator.refresh({
      requestBytesHash: REQUEST_BYTES_HASH,
    });

    expect(dependencies.proofGateway.getXrpPaymentProof).toHaveBeenCalledWith({
      requestBytes: REQUEST_BYTES,
      votingRoundId: 3n,
    });
    expect(proofReady).toMatchObject({
      proof: { encodedProof: "0xdead" },
      record: { status: "PROOF_READY" },
    });
    await store.close();
  });

  it("resumes a submitted request after a worker restart without another verifier request or FdcHub fee", async () => {
    const first = await createCoordinator();
    await first.coordinator.prepare({
      accountId: ACCOUNT_ID,
      transactionId: XRPL_TRANSACTION_ID,
    });
    await first.coordinator.recordSubmitted({
      requestBytesHash: REQUEST_BYTES_HASH,
      requestTransactionHash: REQUEST_TRANSACTION_HASH,
    });
    const databasePath = first.store.databasePath;
    await first.store.close();

    const resumedStore = await createSqliteAttestationStore({ databasePath });
    const resumedDependencies = {
      ...first.dependencies,
      store: resumedStore,
    };
    const resumed = new XrpPaymentAttestationCoordinator(resumedDependencies);

    await expect(
      resumed.refresh({ requestBytesHash: REQUEST_BYTES_HASH }),
    ).resolves.toMatchObject({ record: { status: "PROOF_READY" } });
    expect(
      resumedDependencies.verifier.prepareXrpPayment,
    ).toHaveBeenCalledOnce();
    expect(resumedDependencies.fdcHub.getRequestFee).toHaveBeenCalledOnce();
    expect(
      resumedDependencies.proofGateway.getXrpPaymentProof,
    ).toHaveBeenCalledWith({
      requestBytes: REQUEST_BYTES,
      votingRoundId: 3n,
    });
    await resumedStore.close();
  });

  it("leaves a retryable DA failure in FETCHING_PROOF and expires stale requests", async () => {
    let currentTime = NOW;
    const { coordinator, store } = await createCoordinator({
      now: () => currentTime,
      proofGateway: {
        getXrpPaymentProof: vi.fn().mockRejectedValue(new Error("DA offline")),
        isRoundFinalized: vi.fn().mockResolvedValue(true),
      },
    });
    await coordinator.prepare({
      accountId: ACCOUNT_ID,
      transactionId: XRPL_TRANSACTION_ID,
    });
    await coordinator.recordSubmitted({
      requestBytesHash: REQUEST_BYTES_HASH,
      requestTransactionHash: REQUEST_TRANSACTION_HASH,
    });

    await expect(
      coordinator.refresh({ requestBytesHash: REQUEST_BYTES_HASH }),
    ).rejects.toMatchObject({ code: "DA_UNAVAILABLE" });
    await expect(
      store.getByRequestBytesHash(REQUEST_BYTES_HASH),
    ).resolves.toMatchObject({ status: "FETCHING_PROOF" });

    currentTime = new Date(NOW.getTime() + 60_001);
    await expect(
      coordinator.refresh({ requestBytesHash: REQUEST_BYTES_HASH }),
    ).rejects.toMatchObject({ code: "EXPIRED" });
    await expect(
      store.getByRequestBytesHash(REQUEST_BYTES_HASH),
    ).resolves.toMatchObject({ status: "EXPIRED" });
    await store.close();
  });

  it("uses ReserveFlowCore events as the only source of VERIFIED or FAILED", async () => {
    const { coordinator, store } = await createCoordinator();
    await coordinator.prepare({
      accountId: ACCOUNT_ID,
      transactionId: XRPL_TRANSACTION_ID,
    });
    await coordinator.recordSubmitted({
      requestBytesHash: REQUEST_BYTES_HASH,
      requestTransactionHash: REQUEST_TRANSACTION_HASH,
    });
    await coordinator.refresh({ requestBytesHash: REQUEST_BYTES_HASH });

    const verified = await coordinator.confirmCoreSubmission({
      requestBytesHash: REQUEST_BYTES_HASH,
      transactionHash: CORE_SUBMISSION_TRANSACTION_HASH,
    });
    expect(verified).toMatchObject({
      coreEventTransactionHash: CORE_SUBMISSION_TRANSACTION_HASH,
      status: "VERIFIED",
    });

    const second = await createCoordinator({
      coreEvents: {
        getProofSubmissionOutcome: vi.fn().mockResolvedValue({
          failure: {
            code: "INVALID_FDC_PROOF",
            message: "Proof verification failed.",
          },
          kind: "REJECTED",
        }),
      },
    });
    await second.coordinator.prepare({
      accountId: ACCOUNT_ID,
      transactionId: XRPL_TRANSACTION_ID,
    });
    await second.coordinator.recordSubmitted({
      requestBytesHash: REQUEST_BYTES_HASH,
      requestTransactionHash: REQUEST_TRANSACTION_HASH,
    });
    await second.coordinator.refresh({ requestBytesHash: REQUEST_BYTES_HASH });

    await expect(
      second.coordinator.confirmCoreSubmission({
        requestBytesHash: REQUEST_BYTES_HASH,
        transactionHash: CORE_SUBMISSION_TRANSACTION_HASH,
      }),
    ).resolves.toMatchObject({
      failure: { code: "INVALID_FDC_PROOF" },
      status: "FAILED",
    });
    await store.close();
    await second.store.close();
  });
});
