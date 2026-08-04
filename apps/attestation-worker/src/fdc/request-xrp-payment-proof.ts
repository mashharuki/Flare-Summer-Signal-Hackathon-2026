type Hex = `0x${string}`;
type Direction = "incoming" | "outgoing";

export const FDC_XRP_PAYMENT_CONFIRMATION = "SUBMIT_COSTON2_XRP_PAYMENT_PROOF";
export const XRPL_PAYMENT_ATTESTATION_TYPE: Hex =
  "0x5852505061796d656e7400000000000000000000000000000000000000000000";
export const TEST_XRP_SOURCE_ID: Hex =
  "0x7465737458525000000000000000000000000000000000000000000000000000";

export interface XrpPaymentProof {
  readonly merkleProof: readonly Hex[];
  readonly data: {
    readonly attestationType: Hex;
    readonly sourceId: Hex;
    readonly votingRound: bigint;
    readonly lowestUsedTimestamp: bigint;
    readonly requestBody: {
      readonly proofOwner: Hex;
      readonly transactionId: Hex;
    };
    readonly responseBody: {
      readonly blockNumber: bigint;
      readonly blockTimestamp: bigint;
      readonly sourceAddress: string;
      readonly receivingAddressHash: Hex;
      readonly sourceAddressHash: Hex;
      readonly intendedReceivingAddressHash: Hex;
      readonly spentAmount: bigint;
      readonly intendedSpentAmount: bigint;
      readonly receivedAmount: bigint;
      readonly intendedReceivedAmount: bigint;
      readonly hasMemoData: boolean;
      readonly firstMemoData: Hex;
      readonly hasDestinationTag: boolean;
      readonly destinationTag: bigint;
      readonly status: number;
    };
  };
}

export interface XrpPaymentProofGateway {
  prepare(input: {
    readonly proofOwner: string;
    readonly transactionId: Hex;
  }): Promise<{ readonly abiEncodedRequest: Hex }>;
  getRequestFee(abiEncodedRequest: Hex): Promise<bigint>;
  findExistingAttestation?(abiEncodedRequest: Hex): Promise<
    | {
        readonly transactionHash: Hex;
        readonly votingRoundId: bigint;
      }
    | undefined
  >;
  submitAttestationRequest(input: {
    readonly abiEncodedRequest: Hex;
    readonly requestFee: bigint;
  }): Promise<{
    readonly transactionHash: Hex;
    readonly votingRoundId: bigint;
  }>;
  waitForRoundFinalization(votingRoundId: bigint): Promise<void>;
  getProof(input: {
    readonly abiEncodedRequest: Hex;
    readonly votingRoundId: bigint;
  }): Promise<XrpPaymentProof>;
  submitReserveProof(input: {
    readonly accountId: Hex;
    readonly proof: XrpPaymentProof;
  }): Promise<{ readonly transactionHash: Hex }>;
}

export interface RequestXrpPaymentProofInput {
  readonly accountId: Hex;
  readonly confirmation: string;
  readonly expectedDirection: Direction;
  readonly externalAddressHash: Hex;
  readonly proofOwner: string;
  readonly signerAddress: string;
  readonly transactionId: Hex;
}

export interface SubmittedXrpPaymentProof {
  readonly attestationRequestTransactionHash: Hex;
  readonly reserveProofTransactionHash: Hex;
  readonly votingRoundId: bigint;
}

function equalHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function requireHex(name: string, value: string, byteLength: number): void {
  if (!new RegExp(`^0x[0-9a-fA-F]{${byteLength * 2}}$`).test(value)) {
    throw new Error(`${name} must be a ${byteLength}-byte hex value.`);
  }
}

function requireEvmAddress(name: string, value: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${name} must be an EVM address.`);
  }
}

function validateInput(input: RequestXrpPaymentProofInput): void {
  if (input.confirmation !== FDC_XRP_PAYMENT_CONFIRMATION) {
    throw new Error(
      `Set FDC_XRP_PAYMENT_CONFIRM=${FDC_XRP_PAYMENT_CONFIRMATION} to submit the Coston2 attestation and proof.`,
    );
  }

  requireHex("FDC_XRP_PAYMENT_TRANSACTION_ID", input.transactionId, 32);
  requireHex("RESERVE_FLOW_ACCOUNT_ID", input.accountId, 32);
  requireHex(
    "RESERVE_FLOW_EXTERNAL_ADDRESS_HASH",
    input.externalAddressHash,
    32,
  );
  requireEvmAddress("FDC_XRP_PAYMENT_PROOF_OWNER", input.proofOwner);
  requireEvmAddress("Borrower signer", input.signerAddress);

  if (!equalHex(input.proofOwner, input.signerAddress)) {
    throw new Error(
      "FDC_XRP_PAYMENT_PROOF_OWNER must match the borrower wallet that signs the Coston2 transactions.",
    );
  }
}

function validateProof(
  input: RequestXrpPaymentProofInput,
  proof: XrpPaymentProof,
): void {
  if (!equalHex(proof.data.attestationType, XRPL_PAYMENT_ATTESTATION_TYPE)) {
    throw new Error("FDC response attestation type is not XRPPayment.");
  }
  if (!equalHex(proof.data.sourceId, TEST_XRP_SOURCE_ID)) {
    throw new Error("FDC response source is not testXRP.");
  }
  if (!equalHex(proof.data.requestBody.transactionId, input.transactionId)) {
    throw new Error(
      "FDC response transaction ID does not match the requested XRPL payment.",
    );
  }
  if (!equalHex(proof.data.requestBody.proofOwner, input.proofOwner)) {
    throw new Error(
      "FDC response proof owner does not match the borrower signer.",
    );
  }
  if (proof.data.responseBody.status !== 0) {
    throw new Error(
      "FDC response does not represent a successful XRPL payment.",
    );
  }

  const incoming = equalHex(
    proof.data.responseBody.receivingAddressHash,
    input.externalAddressHash,
  );
  const outgoing = equalHex(
    proof.data.responseBody.sourceAddressHash,
    input.externalAddressHash,
  );

  if (incoming && outgoing) {
    throw new Error(
      "FDC response must match the configured reserve address in exactly one payment direction.",
    );
  }
  if (input.expectedDirection === "incoming" && !incoming) {
    throw new Error(
      "FDC response does not match the configured incoming reserve address.",
    );
  }
  if (input.expectedDirection === "outgoing" && !outgoing) {
    throw new Error(
      "FDC response does not match the configured outgoing reserve address.",
    );
  }
}

export async function requestXrpPaymentProof(
  input: RequestXrpPaymentProofInput,
  gateway: XrpPaymentProofGateway,
): Promise<SubmittedXrpPaymentProof> {
  validateInput(input);

  const preparedRequest = await gateway.prepare({
    proofOwner: input.proofOwner,
    transactionId: input.transactionId,
  });
  const existingAttestation = await gateway.findExistingAttestation?.(
    preparedRequest.abiEncodedRequest,
  );
  const attestation =
    existingAttestation ??
    (await gateway.submitAttestationRequest({
      abiEncodedRequest: preparedRequest.abiEncodedRequest,
      requestFee: await gateway.getRequestFee(
        preparedRequest.abiEncodedRequest,
      ),
    }));

  await gateway.waitForRoundFinalization(attestation.votingRoundId);
  const proof = await gateway.getProof({
    abiEncodedRequest: preparedRequest.abiEncodedRequest,
    votingRoundId: attestation.votingRoundId,
  });
  validateProof(input, proof);

  const reserveProof = await gateway.submitReserveProof({
    accountId: input.accountId,
    proof,
  });

  return {
    attestationRequestTransactionHash: attestation.transactionHash,
    reserveProofTransactionHash: reserveProof.transactionHash,
    votingRoundId: attestation.votingRoundId,
  };
}
