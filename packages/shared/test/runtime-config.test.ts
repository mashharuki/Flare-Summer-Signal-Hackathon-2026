import { describe, expect, it } from "vitest";

import {
  COSTON2_CHAIN_ID,
  ConfigurationError,
  loadWebRuntimeConfig,
  loadWorkerRuntimeConfig,
} from "../src/runtime-config.js";

describe("runtime configuration", () => {
  it("loads the fixed Coston2/XRPL Testnet MVP scope from valid environment values", () => {
    const webConfig = loadWebRuntimeConfig({
      NEXT_PUBLIC_ATTESTATION_WORKER_URL: "http://localhost:4000",
      NEXT_PUBLIC_COSTON2_RPC_URL:
        "https://coston2-api.flare.network/ext/C/rpc",
    });
    const workerConfig = loadWorkerRuntimeConfig({
      COSTON2_DA_LAYER_URL: "https://ctn2-data-availability.flare.network",
      COSTON2_RPC_URL: "https://coston2-api.flare.network/ext/C/rpc",
      FDC_VERIFIER_API_KEY_TESTNET: "test-key",
      FDC_VERIFIER_URL_TESTNET: "https://fdc-verifiers-testnet.flare.network",
    });

    expect(webConfig.chainId).toBe(COSTON2_CHAIN_ID);
    expect(workerConfig.assetSymbol).toBe("XRP");
    expect(workerConfig.sourceId).toBe("testXRP");
    expect(workerConfig.rfUsdSymbol).toBe("rfUSD");
  });

  it("rejects a missing worker secret without exposing its value", () => {
    expect(() =>
      loadWorkerRuntimeConfig({
        COSTON2_DA_LAYER_URL: "https://ctn2-data-availability.flare.network",
        COSTON2_RPC_URL: "https://coston2-api.flare.network/ext/C/rpc",
        FDC_VERIFIER_URL_TESTNET: "https://fdc-verifiers-testnet.flare.network",
      }),
    ).toThrow(
      new ConfigurationError(
        "Missing required environment variable: FDC_VERIFIER_API_KEY_TESTNET",
      ),
    );
  });

  it("rejects malformed public URLs before a workspace starts", () => {
    expect(() =>
      loadWebRuntimeConfig({
        NEXT_PUBLIC_ATTESTATION_WORKER_URL: "not-a-url",
        NEXT_PUBLIC_COSTON2_RPC_URL:
          "https://coston2-api.flare.network/ext/C/rpc",
      }),
    ).toThrow(
      new ConfigurationError(
        "Invalid URL in environment variable: NEXT_PUBLIC_ATTESTATION_WORKER_URL",
      ),
    );
  });
});
