import { type Address, asAddress } from "@reserveflow/shared";
import {
  createPublicClient,
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionData,
  defineChain,
  encodeAbiParameters,
  getAddress,
  type Hex,
  http,
  parseAbi,
  parseAbiItem,
  parseAbiParameters,
} from "viem";
import { createSqliteAttestationStore } from "../persistence/attestation-store.js";
import { fetchJson, normalizeHttpsBaseUrl } from "./http.js";
import type { XrpPaymentAttestationCoordinatorDependencies } from "./xrp-payment-attestation-coordinator.js";

const CONTRACT_REGISTRY_ADDRESS =
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as const;
const COSTON2_CHAIN_ID = 114;
const FDC_PROTOCOL_ID = 200n;
const XRPL_PAYMENT_ATTESTATION_TYPE =
  "0x5852505061796d656e7400000000000000000000000000000000000000000000" as const;
const TEST_XRP_SOURCE_ID =
  "0x7465737458525000000000000000000000000000000000000000000000000000" as const;

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
const coreAbi = parseAbi([
  "function getReserveAccount(bytes32 accountId) view returns (address borrower, bytes32 sourceId, bytes32 externalAddressHash, uint256 balanceDrops, uint64 lastExternalLedger, uint64 lastAttestedAt, uint8 status)",
]);
const feeConfigurationAbi = parseAbi([
  "function getRequestFee(bytes abiEncodedRequest) view returns (uint256)",
]);
const fdcHubAbi = parseAbi([
  "function requestAttestation(bytes abiEncodedRequest) payable",
]);
const systemsManagerAbi = parseAbi([
  "function firstVotingRoundStartTs() view returns (uint256)",
  "function votingEpochDurationSeconds() view returns (uint256)",
]);
const relayAbi = parseAbi([
  "function isFinalized(uint256 protocolId, uint256 votingRoundId) view returns (bool)",
]);
const reserveUpdatedEvent = parseAbiItem(
  "event ReserveUpdated(bytes32 indexed accountId, bytes32 indexed proofId, bool incoming, uint256 amountDrops, uint256 balanceDrops, uint64 externalLedger, uint64 attestedAt)",
);
const xrpPaymentResponseParameters = parseAbiParameters(
  "(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, (bytes32 transactionId, address proofOwner) requestBody, (uint64 blockNumber, uint64 blockTimestamp, string sourceAddress, bytes32 sourceAddressHash, bytes32 receivingAddressHash, bytes32 intendedReceivingAddressHash, int256 spentAmount, int256 intendedSpentAmount, int256 receivedAmount, int256 intendedReceivedAmount, bool hasMemoData, bytes firstMemoData, bool hasDestinationTag, uint256 destinationTag, uint8 status) responseBody)",
);
const xrpPaymentProofParameters = parseAbiParameters(
  "bytes32[] merkleProof, (bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, (bytes32 transactionId, address proofOwner) requestBody, (uint64 blockNumber, uint64 blockTimestamp, string sourceAddress, bytes32 sourceAddressHash, bytes32 receivingAddressHash, bytes32 intendedReceivingAddressHash, int256 spentAmount, int256 intendedSpentAmount, int256 receivedAmount, int256 intendedReceivedAmount, bool hasMemoData, bytes firstMemoData, bool hasDestinationTag, uint256 destinationTag, uint8 status) responseBody) data",
);

export interface Coston2AttestationRuntimeOptions {
  readonly coreAddress: Address;
  readonly daLayerUrl: string;
  readonly databasePath: string;
  readonly requestTtlMilliseconds?: number;
  readonly rpcUrl: string;
  readonly verifierApiKey: string;
  readonly verifierUrl: string;
}

export interface Coston2AttestationRuntime {
  readonly dependencies: XrpPaymentAttestationCoordinatorDependencies;
}

/**
 * Builds only read-only FDC dependencies. This module deliberately has no
 * WalletClient, private-key environment variable, or transaction sender.
 */
export async function createCoston2AttestationRuntime(
  options: Coston2AttestationRuntimeOptions,
): Promise<Coston2AttestationRuntime> {
  const publicClient = createPublicClient({
    chain: coston2,
    transport: http(options.rpcUrl),
  });
  const chainId = await publicClient.getChainId();
  if (chainId !== COSTON2_CHAIN_ID) {
    throw new Error(
      `COSTON2_RPC_URL must connect to Coston2 (${COSTON2_CHAIN_ID}).`,
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
    return asAddress(address);
  };
  const [
    fdcHubAddress,
    feeConfigurationAddress,
    relayAddress,
    systemsManagerAddress,
  ] = await Promise.all([
    resolveRegistryContract("FdcHub"),
    resolveRegistryContract("FdcRequestFeeConfigurations"),
    resolveRegistryContract("Relay"),
    resolveRegistryContract("FlareSystemsManager"),
  ]);
  const store = await createSqliteAttestationStore({
    databasePath: options.databasePath,
  });
  const verifierUrl = normalizeHttpsBaseUrl(
    "FDC_VERIFIER_URL_TESTNET",
    options.verifierUrl,
  );
  const daLayerUrl = normalizeHttpsBaseUrl(
    "COSTON2_DA_LAYER_URL",
    options.daLayerUrl,
  );

  return {
    dependencies: {
      accountReader: {
        async getReserveAccount(accountId) {
          const account = await publicClient.readContract({
            abi: coreAbi,
            address: options.coreAddress as Hex,
            args: [accountId as Hex],
            functionName: "getReserveAccount",
          });
          return {
            borrower: asAddress(account[0]),
            sourceId: decodeSourceId(account[1]),
          };
        },
      },
      coreEvents: {
        async getProofSubmissionOutcome({ accountId, transactionHash }) {
          const receipt = await publicClient.getTransactionReceipt({
            hash: transactionHash as Hex,
          });
          if (receipt.status !== "success") {
            return {
              failure: {
                code: "INVALID_FDC_PROOF" as const,
                message:
                  "ReserveFlowCore rejected the submitted proof transaction.",
              },
              kind: "REJECTED" as const,
            };
          }
          const hasReserveUpdate = receipt.logs.some((log) => {
            try {
              const decoded = decodeEventLog({
                abi: [reserveUpdatedEvent],
                data: log.data,
                topics: log.topics,
              });
              return (
                decoded.eventName === "ReserveUpdated" &&
                decoded.args.accountId?.toLowerCase() ===
                  accountId.toLowerCase()
              );
            } catch {
              return false;
            }
          });
          return hasReserveUpdate
            ? { kind: "VERIFIED" as const }
            : { kind: "PENDING" as const };
        },
      },
      fdcHub: {
        address: fdcHubAddress,
        getRequestFee: (requestBytes) =>
          publicClient.readContract({
            abi: feeConfigurationAbi,
            address: feeConfigurationAddress as Hex,
            args: [requestBytes],
            functionName: "getRequestFee",
          }),
        async getRequestReceipt(transactionHash) {
          const [transaction, receipt] = await Promise.all([
            publicClient.getTransaction({ hash: transactionHash as Hex }),
            publicClient.getTransactionReceipt({
              hash: transactionHash as Hex,
            }),
          ]);
          if (!transaction.to) {
            throw new Error("FdcHub request transaction has no recipient.");
          }
          const decoded = decodeFunctionData({
            abi: fdcHubAbi,
            data: transaction.input,
          });
          const requestBytes = decoded.args?.[0];
          if (
            decoded.functionName !== "requestAttestation" ||
            typeof requestBytes !== "string"
          ) {
            throw new Error(
              "Transaction is not an FdcHub requestAttestation call.",
            );
          }
          const block = await publicClient.getBlock({
            blockNumber: receipt.blockNumber,
          });
          return {
            blockTimestamp: block.timestamp,
            chainId: Number(await publicClient.getChainId()),
            paidFeeWei: transaction.value,
            requestBytes: requestBytes as Hex,
            status: receipt.status,
            to: asAddress(getAddress(transaction.to)),
          };
        },
        async getVotingRoundParameters() {
          const [firstVotingRoundStartTimestamp, votingEpochDurationSeconds] =
            await Promise.all([
              publicClient.readContract({
                abi: systemsManagerAbi,
                address: systemsManagerAddress as Hex,
                functionName: "firstVotingRoundStartTs",
              }),
              publicClient.readContract({
                abi: systemsManagerAbi,
                address: systemsManagerAddress as Hex,
                functionName: "votingEpochDurationSeconds",
              }),
            ]);
          return { firstVotingRoundStartTimestamp, votingEpochDurationSeconds };
        },
      },
      now: () => new Date(),
      proofGateway: {
        async getXrpPaymentProof({ requestBytes, votingRoundId }) {
          const raw = await fetchJson(
            "FDC DA Layer",
            `${daLayerUrl}/api/v1/fdc/proof-by-request-round-raw`,
            {
              body: JSON.stringify({
                requestBytes,
                votingRoundId: Number(votingRoundId),
              }),
              headers: { "content-type": "application/json" },
              method: "POST",
            },
          );
          return { encodedProof: encodeDaProof(raw) };
        },
        isRoundFinalized: (votingRoundId) =>
          publicClient.readContract({
            abi: relayAbi,
            address: relayAddress as Hex,
            args: [FDC_PROTOCOL_ID, votingRoundId],
            functionName: "isFinalized",
          }),
      },
      requestTtlMilliseconds: options.requestTtlMilliseconds ?? 15 * 60_000,
      store,
      verifier: {
        async prepareXrpPayment({ proofOwner, transactionId }) {
          const response = await fetchJson(
            "FDC Verifier",
            `${verifierUrl}/verifier/xrp/XRPPayment/prepareRequest`,
            {
              body: JSON.stringify({
                attestationType: XRPL_PAYMENT_ATTESTATION_TYPE,
                requestBody: { proofOwner, transactionId },
                sourceId: TEST_XRP_SOURCE_ID,
              }),
              headers: {
                "content-type": "application/json",
                "x-api-key": options.verifierApiKey,
              },
              method: "POST",
            },
          );
          return { requestBytes: parsePreparedRequest(response) };
        },
      },
    },
  };
}

function decodeSourceId(value: Hex): string {
  const withoutPadding = value.slice(2).replace(/(?:00)+$/, "");
  return Buffer.from(withoutPadding, "hex").toString("utf8");
}

function parsePreparedRequest(value: unknown): Hex {
  if (
    typeof value !== "object" ||
    value === null ||
    !("abiEncodedRequest" in value) ||
    typeof value.abiEncodedRequest !== "string" ||
    !/^0x[0-9a-fA-F]*$/.test(value.abiEncodedRequest)
  ) {
    throw new Error("FDC Verifier response did not contain abiEncodedRequest.");
  }
  return value.abiEncodedRequest as Hex;
}

function encodeDaProof(value: unknown): Hex {
  if (
    typeof value !== "object" ||
    value === null ||
    !("proof" in value) ||
    !("response_hex" in value) ||
    !Array.isArray(value.proof) ||
    !value.proof.every(
      (item) => typeof item === "string" && /^0x[0-9a-fA-F]{64}$/.test(item),
    ) ||
    typeof value.response_hex !== "string" ||
    !/^0x[0-9a-fA-F]*$/.test(value.response_hex)
  ) {
    throw new Error(
      "FDC DA Layer returned an invalid XRPPayment proof payload.",
    );
  }
  const [data] = decodeAbiParameters(
    xrpPaymentResponseParameters,
    value.response_hex as Hex,
  );
  return encodeAbiParameters(xrpPaymentProofParameters, [
    value.proof as readonly Hex[],
    data,
  ] as never);
}
