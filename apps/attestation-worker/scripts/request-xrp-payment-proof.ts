import {
  type Address,
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  decodeFunctionData,
  defineChain,
  encodeAbiParameters,
  getAddress,
  type Hex,
  http,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { isValidClassicAddress } from "xrpl";

import {
  fetchJson,
  HttpRequestError,
  normalizeHttpsBaseUrl,
} from "../src/fdc/http.js";
import {
  requestXrpPaymentProof,
  type XrpPaymentProof,
  type XrpPaymentProofGateway,
} from "../src/fdc/request-xrp-payment-proof.js";
import { votingRoundForRequestBlock } from "../src/fdc/voting-round.js";

const COSTON2_CHAIN_ID = 114;
const CONTRACT_REGISTRY_ADDRESS = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const POLL_INTERVAL_MS = 5_000;
const coston2 = defineChain({
  id: COSTON2_CHAIN_ID,
  name: "Coston2",
  nativeCurrency: { decimals: 18, name: "C2FLR", symbol: "C2FLR" },
  rpcUrls: {
    default: { http: ["https://coston2-api.flare.network/ext/C/rpc"] },
  },
});

const registryAbi = parseAbi([
  "function getContractAddressByName(string contractName) view returns (address)",
]);
const feeConfigurationAbi = parseAbi([
  "function getRequestFee(bytes abiEncodedRequest) view returns (uint256)",
]);
const fdcHubAbi = parseAbi([
  "function requestAttestation(bytes abiEncodedRequest) payable",
]);
const flareSystemsManagerAbi = parseAbi([
  "function firstVotingRoundStartTs() view returns (uint256)",
  "function votingEpochDurationSeconds() view returns (uint256)",
]);
const relayAbi = parseAbi([
  "function isFinalized(uint256 protocolId, uint256 votingRoundId) view returns (bool)",
]);
const fdcVerificationAbi = parseAbi([
  "function fdcProtocolId() view returns (uint256)",
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
const xrpPaymentResponseParameters = parseAbiParameters(
  "(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, (bytes32 transactionId, address proofOwner) requestBody, (uint64 blockNumber, uint64 blockTimestamp, string sourceAddress, bytes32 sourceAddressHash, bytes32 receivingAddressHash, bytes32 intendedReceivingAddressHash, int256 spentAmount, int256 intendedSpentAmount, int256 receivedAmount, int256 intendedReceivedAmount, bool hasMemoData, bytes firstMemoData, bool hasDestinationTag, uint256 destinationTag, uint8 status) responseBody)",
);

interface RawDaLayerProof {
  readonly proof: readonly Hex[];
  readonly response_hex: Hex;
}

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function optionalPositiveInteger(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Number(value);
}

function requiredAddress(name: string): Address {
  const value = requiredEnvironmentValue(name);
  if (!isAddress(value)) {
    throw new Error(`${name} must be a valid EVM address.`);
  }
  return getAddress(value);
}

function requiredPrivateKey(): Hex {
  const value = requiredEnvironmentValue("BORROWER_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      "BORROWER_PRIVATE_KEY must be a 32-byte 0x-prefixed private key.",
    );
  }
  return value as Hex;
}

function requiredTransactionId(): Hex {
  const value = requiredEnvironmentValue("FDC_XRP_PAYMENT_TRANSACTION_ID");
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(
      "FDC_XRP_PAYMENT_TRANSACTION_ID must be a 32-byte XRPL transaction hash.",
    );
  }
  return normalized.toLowerCase() as Hex;
}

function optionalTransactionHash(name: string): Hex | undefined {
  const value = process.env[name]?.trim();
  if (!value) {
    return undefined;
  }
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`${name} must be a 32-byte Coston2 transaction hash.`);
  }
  return normalized.toLowerCase() as Hex;
}

function readDirection(): "incoming" | "outgoing" {
  const direction = requiredEnvironmentValue("RESERVE_FLOW_PAYMENT_DIRECTION");
  if (direction !== "incoming" && direction !== "outgoing") {
    throw new Error(
      "RESERVE_FLOW_PAYMENT_DIRECTION must be either incoming or outgoing.",
    );
  }
  return direction;
}

function reserveAddressHash(): Hex {
  const address = requiredEnvironmentValue("RESERVE_FLOW_XRPL_ADDRESS");
  if (!isValidClassicAddress(address)) {
    throw new Error(
      "RESERVE_FLOW_XRPL_ADDRESS must be a valid XRPL classic address.",
    );
  }
  return keccak256(stringToHex(address));
}

function reserveAccountId(borrower: Address, externalAddressHash: Hex): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("address, bytes32, bytes32"), [
      borrower,
      stringToHex("testXRP", { size: 32 }),
      externalAddressHash,
    ]),
  );
}

function asPreparedRequest(value: unknown): Hex {
  if (
    typeof value !== "object" ||
    value === null ||
    !("abiEncodedRequest" in value) ||
    typeof value.abiEncodedRequest !== "string" ||
    !/^0x[0-9a-fA-F]*$/.test(value.abiEncodedRequest)
  ) {
    throw new Error("Verifier response did not contain abiEncodedRequest.");
  }
  return value.abiEncodedRequest as Hex;
}

function asRawDaLayerProof(value: unknown): RawDaLayerProof | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("response_hex" in value) ||
    !("proof" in value) ||
    typeof value.response_hex !== "string" ||
    !/^0x[0-9a-fA-F]*$/.test(value.response_hex) ||
    !Array.isArray(value.proof) ||
    !value.proof.every(
      (item) => typeof item === "string" && /^0x[0-9a-fA-F]{64}$/.test(item),
    )
  ) {
    return undefined;
  }
  return {
    proof: value.proof as readonly Hex[],
    response_hex: value.response_hex as Hex,
  };
}

function decodeProof(rawProof: RawDaLayerProof): XrpPaymentProof {
  const [data] = decodeAbiParameters(
    xrpPaymentResponseParameters,
    rawProof.response_hex,
  );
  return {
    merkleProof: rawProof.proof,
    data: data as XrpPaymentProof["data"],
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function main(): Promise<void> {
  const rpcUrl = requiredEnvironmentValue("COSTON2_RPC_URL");
  const verifierUrl = normalizeHttpsBaseUrl(
    "FDC_VERIFIER_URL_TESTNET",
    requiredEnvironmentValue("FDC_VERIFIER_URL_TESTNET"),
  );
  const verifierApiKey = requiredEnvironmentValue(
    "FDC_VERIFIER_API_KEY_TESTNET",
  );
  const daLayerUrl = normalizeHttpsBaseUrl(
    "COSTON2_DA_LAYER_URL",
    requiredEnvironmentValue("COSTON2_DA_LAYER_URL"),
  );
  const coreAddress = requiredAddress("RESERVE_FLOW_CORE_ADDRESS");
  const transactionId = requiredTransactionId();
  const expectedDirection = readDirection();
  const externalAddressHash = reserveAddressHash();
  const timeoutMs =
    optionalPositiveInteger("FDC_XRP_PAYMENT_TIMEOUT_SECONDS", 420) * 1_000;
  const account = privateKeyToAccount(requiredPrivateKey());
  const publicClient = createPublicClient({
    chain: coston2,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: coston2,
    transport: http(rpcUrl),
  });

  const chainId = await publicClient.getChainId();
  if (chainId !== COSTON2_CHAIN_ID) {
    throw new Error(
      `COSTON2_RPC_URL must connect to chain ${COSTON2_CHAIN_ID}, got ${chainId}.`,
    );
  }

  const resolveRegistryContract = async (name: string): Promise<Address> => {
    const address = await publicClient.readContract({
      abi: registryAbi,
      address: CONTRACT_REGISTRY_ADDRESS,
      args: [name],
      functionName: "getContractAddressByName",
    });
    if (address === "0x0000000000000000000000000000000000000000") {
      throw new Error(`Coston2 Contract Registry did not resolve ${name}.`);
    }
    return address;
  };

  const [
    fdcHubAddress,
    feeConfigurationAddress,
    relayAddress,
    fdcVerificationAddress,
    flareSystemsManagerAddress,
  ] = await Promise.all([
    resolveRegistryContract("FdcHub"),
    resolveRegistryContract("FdcRequestFeeConfigurations"),
    resolveRegistryContract("Relay"),
    resolveRegistryContract("FdcVerification"),
    resolveRegistryContract("FlareSystemsManager"),
  ]);

  const successfulReceipt = async (hash: Hex) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`Coston2 transaction ${hash} reverted.`);
    }
    return receipt;
  };

  const requestVotingRoundId = async (blockNumber: bigint): Promise<bigint> => {
    const [block, firstVotingRoundStartTimestamp, votingEpochDurationSeconds] =
      await Promise.all([
        publicClient.getBlock({ blockNumber }),
        publicClient.readContract({
          abi: flareSystemsManagerAbi,
          address: flareSystemsManagerAddress,
          functionName: "firstVotingRoundStartTs",
        }),
        publicClient.readContract({
          abi: flareSystemsManagerAbi,
          address: flareSystemsManagerAddress,
          functionName: "votingEpochDurationSeconds",
        }),
      ]);
    return votingRoundForRequestBlock({
      blockTimestamp: block.timestamp,
      firstVotingRoundStartTimestamp,
      votingEpochDurationSeconds,
    });
  };

  const gateway: XrpPaymentProofGateway = {
    prepare: async ({ proofOwner, transactionId: requestTransactionId }) => {
      const preparedRequest = await fetchJson(
        "FDC Verifier",
        `${verifierUrl}/verifier/xrp/XRPPayment/prepareRequest`,
        {
          body: JSON.stringify({
            attestationType:
              "0x5852505061796d656e7400000000000000000000000000000000000000000000",
            requestBody: {
              proofOwner,
              transactionId: requestTransactionId,
            },
            sourceId:
              "0x7465737458525000000000000000000000000000000000000000000000000000",
          }),
          headers: {
            "content-type": "application/json",
            "x-api-key": verifierApiKey,
          },
          method: "POST",
        },
      );
      return { abiEncodedRequest: asPreparedRequest(preparedRequest) };
    },
    getRequestFee: (abiEncodedRequest) =>
      publicClient.readContract({
        abi: feeConfigurationAbi,
        address: feeConfigurationAddress,
        args: [abiEncodedRequest],
        functionName: "getRequestFee",
      }),
    submitAttestationRequest: async ({ abiEncodedRequest, requestFee }) => {
      const transactionHash = await walletClient.writeContract({
        abi: fdcHubAbi,
        address: fdcHubAddress,
        args: [abiEncodedRequest],
        functionName: "requestAttestation",
        value: requestFee,
      });
      const receipt = await successfulReceipt(transactionHash);
      const votingRoundId = await requestVotingRoundId(receipt.blockNumber);
      console.log(
        JSON.stringify({
          attestationRequestTransactionHash: transactionHash,
          stage: "attestation-request-submitted",
          votingRoundId: votingRoundId.toString(),
        }),
      );
      return { transactionHash, votingRoundId };
    },
    findExistingAttestation: async (abiEncodedRequest) => {
      const transactionHash = optionalTransactionHash(
        "FDC_XRP_PAYMENT_EXISTING_REQUEST_TRANSACTION_HASH",
      );
      if (!transactionHash) {
        return undefined;
      }
      const [transaction, receipt] = await Promise.all([
        publicClient.getTransaction({ hash: transactionHash }),
        publicClient.getTransactionReceipt({ hash: transactionHash }),
      ]);
      if (
        !transaction.to ||
        transaction.to.toLowerCase() !== fdcHubAddress.toLowerCase()
      ) {
        throw new Error(
          "FDC_XRP_PAYMENT_EXISTING_REQUEST_TRANSACTION_HASH is not a transaction to the Coston2 FdcHub.",
        );
      }
      if (receipt.status !== "success") {
        throw new Error(
          "FDC_XRP_PAYMENT_EXISTING_REQUEST_TRANSACTION_HASH did not succeed on Coston2.",
        );
      }
      let decodedRequest: ReturnType<typeof decodeFunctionData>;
      try {
        decodedRequest = decodeFunctionData({
          abi: fdcHubAbi,
          data: transaction.input,
        });
      } catch {
        throw new Error(
          "FDC_XRP_PAYMENT_EXISTING_REQUEST_TRANSACTION_HASH does not contain an FdcHub requestAttestation call.",
        );
      }
      const existingRequestBytes = decodedRequest.args?.[0];
      if (
        decodedRequest.functionName !== "requestAttestation" ||
        typeof existingRequestBytes !== "string" ||
        existingRequestBytes.toLowerCase() !== abiEncodedRequest.toLowerCase()
      ) {
        throw new Error(
          "Existing FdcHub request bytes do not match the requested XRPPayment proof.",
        );
      }
      const votingRoundId = await requestVotingRoundId(receipt.blockNumber);
      console.log(
        JSON.stringify({
          attestationRequestTransactionHash: transactionHash,
          stage: "resuming-attestation-request",
          votingRoundId: votingRoundId.toString(),
        }),
      );
      return { transactionHash, votingRoundId };
    },
    waitForRoundFinalization: async (votingRoundId) => {
      const protocolId = await publicClient.readContract({
        abi: fdcVerificationAbi,
        address: fdcVerificationAddress,
        functionName: "fdcProtocolId",
      });
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const finalized = await publicClient.readContract({
          abi: relayAbi,
          address: relayAddress,
          args: [protocolId, votingRoundId],
          functionName: "isFinalized",
        });
        if (finalized) {
          return;
        }
        await wait(POLL_INTERVAL_MS);
      }
      throw new Error(
        `FDC voting round ${votingRoundId} did not finalize before the configured timeout. The attestation request remains on-chain; do not resubmit it automatically.`,
      );
    },
    getProof: async ({ abiEncodedRequest, votingRoundId }) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        let proofResponse: unknown;
        try {
          proofResponse = await fetchJson(
            "FDC DA Layer",
            `${daLayerUrl}/api/v1/fdc/proof-by-request-round-raw`,
            {
              body: JSON.stringify({
                requestBytes: abiEncodedRequest,
                votingRoundId: Number(votingRoundId),
              }),
              headers: { "content-type": "application/json" },
              method: "POST",
            },
          );
        } catch (error) {
          if (error instanceof HttpRequestError && error.status === 400) {
            await wait(POLL_INTERVAL_MS);
            continue;
          }
          throw error;
        }
        const rawProof = asRawDaLayerProof(proofResponse);
        if (rawProof) {
          return decodeProof(rawProof);
        }
        await wait(POLL_INTERVAL_MS);
      }
      throw new Error(
        "DA Layer did not produce an XRPPayment proof before the configured timeout. The attestation request remains on-chain; do not resubmit it automatically.",
      );
    },
    submitReserveProof: async ({ accountId, proof }) => {
      const transactionHash = await walletClient.writeContract({
        abi: reserveFlowCoreAbi,
        address: coreAddress,
        args: [accountId, proof as never],
        functionName: "submitXrpPaymentProof",
      });
      await successfulReceipt(transactionHash);
      return { transactionHash };
    },
  };

  const result = await requestXrpPaymentProof(
    {
      accountId: reserveAccountId(account.address, externalAddressHash),
      confirmation: process.env.FDC_XRP_PAYMENT_CONFIRM ?? "",
      expectedDirection,
      externalAddressHash,
      proofOwner: account.address,
      signerAddress: account.address,
      transactionId,
    },
    gateway,
  );

  console.log(
    JSON.stringify(
      {
        attestationRequestTransactionHash:
          result.attestationRequestTransactionHash,
        reserveFlowCore: coreAddress,
        reserveProofTransactionHash: result.reserveProofTransactionHash,
        votingRoundId: result.votingRoundId.toString(),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown failure";
  console.error(message);
  process.exitCode = 1;
});
