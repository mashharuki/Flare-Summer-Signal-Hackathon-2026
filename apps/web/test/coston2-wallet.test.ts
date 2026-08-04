import { asAccountId, asTransactionHash } from "@reserveflow/shared";
import { describe, expect, it, vi } from "vitest";

import {
  createBrowserAttestationWallet,
  createBrowserCreditWallet,
  encodeXrpPaymentProof,
} from "../src/coston2-wallet.js";

const ACCOUNT_ID = asAccountId(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const FDC_HUB = "0x1111111111111111111111111111111111111111" as const;
const CORE = "0x2222222222222222222222222222222222222222" as const;
const VAULT = "0x3333333333333333333333333333333333333333" as const;
const RFUSD = "0x4444444444444444444444444444444444444444" as const;
const FDC_TX = asTransactionHash(
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
);
const CORE_TX = asTransactionHash(
  "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
);

describe("Coston2 browser wallet", () => {
  it("writes the FdcHub request with the exact prepared fee and never delegates signing to Worker", async () => {
    const writeContract = vi
      .fn()
      .mockResolvedValueOnce(FDC_TX)
      .mockResolvedValueOnce(CORE_TX);
    const wallet = createBrowserAttestationWallet({
      fdcHubAddress: FDC_HUB,
      reserveFlowCoreAddress: CORE,
      writeContract,
    });

    await expect(
      wallet.submitFdcHubRequest({ requestBytes: "0x1234", value: 100n }),
    ).resolves.toBe(FDC_TX);
    await expect(
      wallet.submitReserveProof({
        accountId: ACCOUNT_ID,
        encodedProof: encodeXrpPaymentProof({
          data: {
            attestationType: `0x${"01".repeat(32)}`,
            lowestUsedTimestamp: 1n,
            requestBody: {
              proofOwner: "0x3333333333333333333333333333333333333333",
              transactionId: `0x${"02".repeat(32)}`,
            },
            responseBody: {
              blockNumber: 1n,
              blockTimestamp: 1n,
              destinationTag: 0n,
              firstMemoData: "0x",
              hasDestinationTag: false,
              hasMemoData: false,
              intendedReceivedAmount: 1n,
              intendedReceivingAddressHash: `0x${"03".repeat(32)}`,
              intendedSpentAmount: 1n,
              receivedAmount: 1n,
              receivingAddressHash: `0x${"04".repeat(32)}`,
              sourceAddress: "rExample",
              sourceAddressHash: `0x${"05".repeat(32)}`,
              spentAmount: 1n,
              status: 0,
            },
            sourceId: `0x${"06".repeat(32)}`,
            votingRound: 1n,
          },
          merkleProof: [],
        }),
      }),
    ).resolves.toBe(CORE_TX);

    expect(writeContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        address: FDC_HUB,
        functionName: "requestAttestation",
        value: 100n,
      }),
    );
    expect(writeContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        address: CORE,
        functionName: "submitXrpPaymentProof",
      }),
    );
  });

  it("keeps reserve registration, borrowing, approval, and repayment in the connected wallet", async () => {
    const writeContract = vi.fn().mockResolvedValue(`0x${"ee".repeat(32)}`);
    const wallet = createBrowserCreditWallet({
      creditVaultAddress: VAULT,
      reserveFlowCoreAddress: CORE,
      rfUsdAddress: RFUSD,
      writeContract,
    });

    await wallet.registerReserveAccount({
      externalAddressHash: `0x${"01".repeat(32)}`,
    });
    await wallet.openCreditLine({ accountId: ACCOUNT_ID });
    await wallet.borrow({ amountWad: 1n });
    await wallet.approveRfUsd({ amountWad: 1n, vaultAddress: VAULT });
    await wallet.repay({ amountWad: 1n });

    expect(
      writeContract.mock.calls.map(([input]) => input.functionName),
    ).toEqual([
      "registerReserveAccount",
      "openCreditLine",
      "borrow",
      "approve",
      "repay",
    ]);
  });
});
