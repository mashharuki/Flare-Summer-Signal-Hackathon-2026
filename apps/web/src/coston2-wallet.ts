import {
  type AccountId,
  asAccountId,
  type TransactionHash,
} from "@reserveflow/shared";
import {
  type Address,
  createWalletClient,
  custom,
  decodeAbiParameters,
  defineChain,
  encodeAbiParameters,
  type Hex,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
} from "viem";

import type { AttestationWallet } from "./attestation-flow.js";

const coston2 = defineChain({
  id: 114,
  name: "Coston2",
  nativeCurrency: { decimals: 18, name: "C2FLR", symbol: "C2FLR" },
  rpcUrls: {
    default: { http: ["https://coston2-api.flare.network/ext/C/rpc"] },
  },
});

const fdcHubAbi = parseAbi([
  "function requestAttestation(bytes abiEncodedRequest) payable",
]);
const registerReserveAbi = parseAbi([
  "function registerReserveAccount(bytes32 externalAddressHash) returns (bytes32 accountId)",
]);
const creditVaultAbi = parseAbi([
  "function openCreditLine(bytes32 accountId)",
  "function borrow(uint256 amountWad)",
  "function repay(uint256 amountWad)",
]);
const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const reserveFlowCoreAbi = [
  {
    inputs: [
      { name: "accountId", type: "bytes32" },
      {
        components: [
          { name: "merkleProof", type: "bytes32[]" },
          {
            components: [
              { name: "attestationType", type: "bytes32" },
              { name: "sourceId", type: "bytes32" },
              { name: "votingRound", type: "uint64" },
              { name: "lowestUsedTimestamp", type: "uint64" },
              {
                components: [
                  { name: "transactionId", type: "bytes32" },
                  { name: "proofOwner", type: "address" },
                ],
                name: "requestBody",
                type: "tuple",
              },
              {
                components: [
                  { name: "blockNumber", type: "uint64" },
                  { name: "blockTimestamp", type: "uint64" },
                  { name: "sourceAddress", type: "string" },
                  { name: "sourceAddressHash", type: "bytes32" },
                  { name: "receivingAddressHash", type: "bytes32" },
                  { name: "intendedReceivingAddressHash", type: "bytes32" },
                  { name: "spentAmount", type: "int256" },
                  { name: "intendedSpentAmount", type: "int256" },
                  { name: "receivedAmount", type: "int256" },
                  { name: "intendedReceivedAmount", type: "int256" },
                  { name: "hasMemoData", type: "bool" },
                  { name: "firstMemoData", type: "bytes" },
                  { name: "hasDestinationTag", type: "bool" },
                  { name: "destinationTag", type: "uint256" },
                  { name: "status", type: "uint8" },
                ],
                name: "responseBody",
                type: "tuple",
              },
            ],
            name: "data",
            type: "tuple",
          },
        ],
        name: "proof",
        type: "tuple",
      },
    ],
    name: "submitXrpPaymentProof",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
const xrpPaymentProofParameters = parseAbiParameters(
  "bytes32[] merkleProof, (bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, (bytes32 transactionId, address proofOwner) requestBody, (uint64 blockNumber, uint64 blockTimestamp, string sourceAddress, bytes32 sourceAddressHash, bytes32 receivingAddressHash, bytes32 intendedReceivingAddressHash, int256 spentAmount, int256 intendedSpentAmount, int256 receivedAmount, int256 intendedReceivedAmount, bool hasMemoData, bytes firstMemoData, bool hasDestinationTag, uint256 destinationTag, uint8 status) responseBody) data",
);

export interface XrpPaymentProofForSubmission {
  readonly data: {
    readonly attestationType: Hex;
    readonly sourceId: Hex;
    readonly votingRound: bigint;
    readonly lowestUsedTimestamp: bigint;
    readonly requestBody: {
      readonly transactionId: Hex;
      readonly proofOwner: Address;
    };
    readonly responseBody: {
      readonly blockNumber: bigint;
      readonly blockTimestamp: bigint;
      readonly sourceAddress: string;
      readonly sourceAddressHash: Hex;
      readonly receivingAddressHash: Hex;
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
  readonly merkleProof: readonly Hex[];
}

export interface ContractWriter {
  writeContract(input: {
    readonly abi: readonly unknown[];
    readonly address: Address;
    readonly args: readonly unknown[];
    readonly functionName: string;
    readonly value?: bigint;
  }): Promise<Hex>;
}

export interface BrowserAttestationWalletOptions extends ContractWriter {
  readonly fdcHubAddress: Address;
  readonly reserveFlowCoreAddress: Address;
}

export interface CreditWallet {
  approveRfUsd(input: {
    readonly amountWad: bigint;
    readonly vaultAddress: Address;
  }): Promise<TransactionHash>;
  borrow(input: { readonly amountWad: bigint }): Promise<TransactionHash>;
  openCreditLine(input: {
    readonly accountId: AccountId;
  }): Promise<TransactionHash>;
  registerReserveAccount(input: {
    readonly externalAddressHash: Hex;
  }): Promise<TransactionHash>;
  repay(input: { readonly amountWad: bigint }): Promise<TransactionHash>;
}

export function deriveTestXrpAccountId(input: {
  readonly borrower: Address;
  readonly xrplClassicAddress: string;
}): AccountId {
  const externalAddressHash = keccak256(stringToHex(input.xrplClassicAddress));
  return asAccountId(
    keccak256(
      encodeAbiParameters(parseAbiParameters("address, bytes32, bytes32"), [
        input.borrower,
        stringToHex("testXRP", { size: 32 }),
        externalAddressHash,
      ]),
    ),
  );
}

export function createBrowserCreditWallet(
  input: ContractWriter & {
    readonly creditVaultAddress: Address;
    readonly reserveFlowCoreAddress: Address;
    readonly rfUsdAddress: Address;
  },
): CreditWallet {
  return {
    approveRfUsd: ({ amountWad, vaultAddress }) =>
      input.writeContract({
        abi: erc20Abi,
        address: input.rfUsdAddress,
        args: [vaultAddress, amountWad],
        functionName: "approve",
      }) as Promise<TransactionHash>,
    borrow: ({ amountWad }) =>
      input.writeContract({
        abi: creditVaultAbi,
        address: input.creditVaultAddress,
        args: [amountWad],
        functionName: "borrow",
      }) as Promise<TransactionHash>,
    openCreditLine: ({ accountId }) =>
      input.writeContract({
        abi: creditVaultAbi,
        address: input.creditVaultAddress,
        args: [accountId],
        functionName: "openCreditLine",
      }) as Promise<TransactionHash>,
    registerReserveAccount: ({ externalAddressHash }) =>
      input.writeContract({
        abi: registerReserveAbi,
        address: input.reserveFlowCoreAddress,
        args: [externalAddressHash],
        functionName: "registerReserveAccount",
      }) as Promise<TransactionHash>,
    repay: ({ amountWad }) =>
      input.writeContract({
        abi: creditVaultAbi,
        address: input.creditVaultAddress,
        args: [amountWad],
        functionName: "repay",
      }) as Promise<TransactionHash>,
  };
}

export interface BrowserEip1193Provider {
  request(input: {
    readonly method: string;
    readonly params?: readonly unknown[];
  }): Promise<unknown>;
}

export function createBrowserAttestationWallet(
  options: BrowserAttestationWalletOptions,
): AttestationWallet {
  return {
    async submitFdcHubRequest({ requestBytes, value }) {
      return options.writeContract({
        abi: fdcHubAbi,
        address: options.fdcHubAddress,
        args: [requestBytes],
        functionName: "requestAttestation",
        value,
      }) as Promise<TransactionHash>;
    },
    async submitReserveProof({ accountId, encodedProof }) {
      const proof = decodeXrpPaymentProof(encodedProof);
      return options.writeContract({
        abi: reserveFlowCoreAbi,
        address: options.reserveFlowCoreAddress,
        args: [accountId, proof],
        functionName: "submitXrpPaymentProof",
      }) as Promise<TransactionHash>;
    },
  };
}

/** Connects a browser-owned EIP-1193 wallet; no key is copied into the app. */
export function createCoston2BrowserAttestationWallet(input: {
  readonly account: Address;
  readonly fdcHubAddress: Address;
  readonly provider: BrowserEip1193Provider;
  readonly reserveFlowCoreAddress: Address;
}): AttestationWallet {
  return createCoston2BrowserWallet(input).attestationWallet;
}

export function createCoston2BrowserWallet(input: {
  readonly account: Address;
  readonly creditVaultAddress?: Address;
  readonly fdcHubAddress: Address;
  readonly provider: BrowserEip1193Provider;
  readonly reserveFlowCoreAddress: Address;
  readonly rfUsdAddress?: Address;
}): {
  readonly attestationWallet: AttestationWallet;
  readonly creditWallet?: CreditWallet;
  readonly signMessage: (message: string) => Promise<Hex>;
} {
  const walletClient = createWalletClient({
    account: input.account,
    chain: coston2,
    transport: custom(input.provider),
  });
  const writeContract = (
    request: Parameters<ContractWriter["writeContract"]>[0],
  ) => walletClient.writeContract(request as never);
  const attestationWallet = createBrowserAttestationWallet({
    fdcHubAddress: input.fdcHubAddress,
    reserveFlowCoreAddress: input.reserveFlowCoreAddress,
    writeContract,
  });
  const creditWallet =
    input.creditVaultAddress && input.rfUsdAddress
      ? createBrowserCreditWallet({
          creditVaultAddress: input.creditVaultAddress,
          reserveFlowCoreAddress: input.reserveFlowCoreAddress,
          rfUsdAddress: input.rfUsdAddress,
          writeContract,
        })
      : undefined;
  return {
    attestationWallet,
    ...(creditWallet === undefined ? {} : { creditWallet }),
    signMessage: async (message) => walletClient.signMessage({ message }),
  };
}

export function encodeXrpPaymentProof(
  proof: XrpPaymentProofForSubmission,
): Hex {
  return encodeAbiParameters(xrpPaymentProofParameters, [
    proof.merkleProof,
    proof.data,
  ] as never);
}

export function decodeXrpPaymentProof(
  encodedProof: Hex,
): XrpPaymentProofForSubmission {
  const [merkleProof, data] = decodeAbiParameters(
    xrpPaymentProofParameters,
    encodedProof,
  );
  return { data, merkleProof } as XrpPaymentProofForSubmission;
}
