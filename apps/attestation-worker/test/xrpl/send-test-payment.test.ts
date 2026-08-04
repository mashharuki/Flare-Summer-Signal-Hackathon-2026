import { describe, expect, it, vi } from "vitest";

import {
  sendXrplTestPayment,
  type XrplTestPaymentClient,
} from "../../src/xrpl/send-test-payment.js";

const DESTINATION = "rzWkjaqswtLmRCzg2Jrm9kVSvgNeGkWQq";
const SENDER = "rSenderAddress111111111111111111";

function createClient(result: {
  readonly hash: string;
  readonly meta: { readonly TransactionResult: string };
  readonly validated: boolean;
}): XrplTestPaymentClient & {
  readonly connect: ReturnType<typeof vi.fn>;
  readonly disconnect: ReturnType<typeof vi.fn>;
  readonly submitAndWait: ReturnType<typeof vi.fn>;
} {
  return {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    submitAndWait: vi.fn(async () => ({ result })),
  };
}

describe("sendXrplTestPayment", () => {
  it("submits a validated XRP Testnet payment and returns its transaction hash", async () => {
    const client = createClient({
      hash: "A".repeat(64),
      meta: { TransactionResult: "tesSUCCESS" },
      validated: true,
    });

    const payment = await sendXrplTestPayment({
      client,
      destination: DESTINATION,
      isValidClassicAddress: () => true,
      sender: { classicAddress: SENDER },
      toDrops: (xrp) => (xrp === "2" ? "2000000" : "0"),
      amountXrp: "2",
    });

    expect(payment).toEqual({
      amountDrops: "2000000",
      transactionHash: "A".repeat(64),
    });
    expect(client.submitAndWait).toHaveBeenCalledWith(
      {
        Account: SENDER,
        Amount: "2000000",
        Destination: DESTINATION,
        TransactionType: "Payment",
      },
      { wallet: { classicAddress: SENDER } },
    );
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it("rejects an invalid destination before connecting or submitting", async () => {
    const client = createClient({
      hash: "A".repeat(64),
      meta: { TransactionResult: "tesSUCCESS" },
      validated: true,
    });

    await expect(
      sendXrplTestPayment({
        client,
        destination: "not-an-xrpl-address",
        isValidClassicAddress: () => false,
        sender: { classicAddress: SENDER },
        toDrops: () => "2000000",
        amountXrp: "2",
      }),
    ).rejects.toThrow("XRPL Testnet destination");

    expect(client.connect).not.toHaveBeenCalled();
    expect(client.submitAndWait).not.toHaveBeenCalled();
  });

  it("rejects tentative or failed payments even when submission returns a hash", async () => {
    const client = createClient({
      hash: "B".repeat(64),
      meta: { TransactionResult: "tecUNFUNDED_PAYMENT" },
      validated: false,
    });

    await expect(
      sendXrplTestPayment({
        client,
        destination: DESTINATION,
        isValidClassicAddress: () => true,
        sender: { classicAddress: SENDER },
        toDrops: () => "2000000",
        amountXrp: "2",
      }),
    ).rejects.toThrow("validated tesSUCCESS");

    expect(client.disconnect).toHaveBeenCalledOnce();
  });
});
