import {
  type Address,
  createPublicClient,
  defineChain,
  http,
  parseAbi,
} from "viem";

import { runCoston2FdcSmoke } from "../src/fdc/coston2-fdc-smoke.js";

const COSTON2_CHAIN_ID = 114;
const CONTRACT_REGISTRY_ADDRESS = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const SMOKE_CONFIRMATION = "READ_COSTON2_FDC";
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

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function main(): Promise<void> {
  if (process.env.COSTON2_FDC_SMOKE_CONFIRM !== SMOKE_CONFIRMATION) {
    throw new Error(
      `Set COSTON2_FDC_SMOKE_CONFIRM=${SMOKE_CONFIRMATION} to run this read-only Coston2 smoke check.`,
    );
  }
  const client = createPublicClient({
    chain: coston2,
    transport: http(requiredEnvironmentValue("COSTON2_RPC_URL")),
  });
  const chainId = await client.getChainId();
  if (chainId !== COSTON2_CHAIN_ID) {
    throw new Error(
      `COSTON2_RPC_URL must connect to chain ${COSTON2_CHAIN_ID}, got ${chainId}.`,
    );
  }

  const dependencies = await runCoston2FdcSmoke({
    getContractAddressByName: (contractName) =>
      client.readContract({
        abi: registryAbi,
        address: CONTRACT_REGISTRY_ADDRESS,
        args: [contractName],
        functionName: "getContractAddressByName",
      }) as Promise<Address>,
  });
  console.log(
    JSON.stringify({
      chainId: COSTON2_CHAIN_ID,
      mode: "read-only",
      registry: CONTRACT_REGISTRY_ADDRESS,
      ...dependencies,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown failure");
  process.exitCode = 1;
});
