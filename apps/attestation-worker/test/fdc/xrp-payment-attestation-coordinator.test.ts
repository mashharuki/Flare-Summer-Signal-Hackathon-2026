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
    now: () => NOW,
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
});
