import { Client, isValidClassicAddress, Wallet, xrpToDrops } from "xrpl";

import {
  sendXrplTestPayment,
  type XrplTestPaymentClient,
} from "../src/xrpl/send-test-payment.js";

const XRPL_TESTNET_WS_URL = "wss://s.altnet.rippletest.net:51233";
const SEND_CONFIRMATION = "SEND_TEST_XRP";

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function main(): Promise<void> {
  if (process.env.XRPL_TESTNET_CONFIRM !== SEND_CONFIRMATION) {
    throw new Error(
      `Set XRPL_TESTNET_CONFIRM=${SEND_CONFIRMATION} to send Test XRP.`,
    );
  }

  const destination = requiredEnvironmentValue("XRPL_TESTNET_DESTINATION");
  const seed = requiredEnvironmentValue("XRPL_TESTNET_SENDER_SEED");
  const amountXrp = process.env.XRPL_TESTNET_AMOUNT_XRP?.trim() || "2";
  const wallet = Wallet.fromSeed(seed);
  const client = new Client(XRPL_TESTNET_WS_URL);
  const paymentClient: XrplTestPaymentClient = {
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
    submitAndWait: async (transaction) => {
      const response = await client.submitAndWait(
        {
          Account: transaction.Account,
          Amount: transaction.Amount,
          Destination: transaction.Destination,
          TransactionType: "Payment",
        },
        { wallet },
      );
      const result = response.result;
      const transactionResult =
        typeof result.meta === "object" &&
        result.meta !== null &&
        "TransactionResult" in result.meta &&
        typeof result.meta.TransactionResult === "string"
          ? result.meta.TransactionResult
          : "";

      return {
        result: {
          hash: result.hash,
          meta: { TransactionResult: transactionResult },
          validated: result.validated === true,
        },
      };
    },
  };

  const payment = await sendXrplTestPayment({
    amountXrp,
    client: paymentClient,
    destination,
    isValidClassicAddress,
    sender: wallet,
    toDrops: xrpToDrops,
  });

  console.log(
    JSON.stringify(
      {
        amountDrops: payment.amountDrops,
        destination,
        network: "XRPL Testnet",
        transactionHash: payment.transactionHash,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown XRPL Testnet payment error.";

  console.error(message);
  process.exitCode = 1;
});
