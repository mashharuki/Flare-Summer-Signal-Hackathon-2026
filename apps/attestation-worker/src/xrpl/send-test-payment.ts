export interface XrplTestPaymentWallet {
  readonly classicAddress: string;
}

export interface XrplTestPaymentTransaction {
  readonly Account: string;
  readonly Amount: string;
  readonly Destination: string;
  readonly TransactionType: "Payment";
}

export interface XrplTestPaymentResult {
  readonly hash: string;
  readonly meta: {
    readonly TransactionResult: string;
  };
  readonly validated: boolean;
}

export interface XrplTestPaymentClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  submitAndWait(
    transaction: XrplTestPaymentTransaction,
    options: { readonly wallet: XrplTestPaymentWallet },
  ): Promise<{ readonly result: XrplTestPaymentResult }>;
}

export interface SendXrplTestPaymentInput {
  readonly amountXrp: string;
  readonly client: XrplTestPaymentClient;
  readonly destination: string;
  readonly isValidClassicAddress: (address: string) => boolean;
  readonly sender: XrplTestPaymentWallet;
  readonly toDrops: (xrp: string) => string;
}

export interface SubmittedXrplTestPayment {
  readonly amountDrops: string;
  readonly transactionHash: string;
}

function amountInDrops(
  amountXrp: string,
  toDrops: (xrp: string) => string,
): string {
  if (!/^\d+(?:\.\d{1,6})?$/.test(amountXrp)) {
    throw new Error(
      "XRPL Testnet amount must be a positive XRP value with at most six decimal places.",
    );
  }

  const drops = toDrops(amountXrp);
  if (BigInt(drops) <= 0n) {
    throw new Error("XRPL Testnet amount must be greater than zero.");
  }

  return drops;
}

/**
 * Sends a native XRP Payment only after validating the Testnet destination and
 * returns only a final, successful transaction hash.
 */
export async function sendXrplTestPayment({
  amountXrp,
  client,
  destination,
  isValidClassicAddress,
  sender,
  toDrops,
}: SendXrplTestPaymentInput): Promise<SubmittedXrplTestPayment> {
  if (!isValidClassicAddress(destination)) {
    throw new Error(
      "XRPL Testnet destination must be a valid classic address.",
    );
  }

  const amountDrops = amountInDrops(amountXrp, toDrops);
  await client.connect();

  try {
    const response = await client.submitAndWait(
      {
        Account: sender.classicAddress,
        Amount: amountDrops,
        Destination: destination,
        TransactionType: "Payment",
      },
      { wallet: sender },
    );
    const { result } = response;

    if (!result.validated || result.meta.TransactionResult !== "tesSUCCESS") {
      throw new Error(
        "XRPL Testnet payment did not reach validated tesSUCCESS.",
      );
    }

    return { amountDrops, transactionHash: result.hash };
  } finally {
    await client.disconnect();
  }
}
