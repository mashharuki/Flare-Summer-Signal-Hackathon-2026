export const COSTON2_CHAIN_ID = 114 as const;

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export class ConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export interface WebRuntimeConfig {
  readonly attestationWorkerUrl: URL;
  readonly chainId: typeof COSTON2_CHAIN_ID;
  readonly coston2RpcUrl: URL;
  readonly networkName: "Coston2";
}

export interface WorkerRuntimeConfig {
  readonly assetSymbol: "XRP";
  readonly coston2DaLayerUrl: URL;
  readonly coston2RpcUrl: URL;
  readonly fdcVerifierApiKey: string;
  readonly fdcVerifierUrl: URL;
  readonly networkName: "Coston2";
  readonly rfUsdSymbol: "rfUSD";
  readonly sourceId: "testXRP";
}

function requiredValue(environment: RuntimeEnvironment, key: string): string {
  const value = environment[key]?.trim();

  if (!value) {
    throw new ConfigurationError(
      `Missing required environment variable: ${key}`,
    );
  }

  return value;
}

function requiredUrl(environment: RuntimeEnvironment, key: string): URL {
  const value = requiredValue(environment, key);

  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new TypeError("Unsupported protocol");
    }

    return url;
  } catch {
    throw new ConfigurationError(`Invalid URL in environment variable: ${key}`);
  }
}

export function loadWebRuntimeConfig(
  environment: RuntimeEnvironment,
): WebRuntimeConfig {
  return {
    attestationWorkerUrl: requiredUrl(
      environment,
      "NEXT_PUBLIC_ATTESTATION_WORKER_URL",
    ),
    chainId: COSTON2_CHAIN_ID,
    coston2RpcUrl: requiredUrl(environment, "NEXT_PUBLIC_COSTON2_RPC_URL"),
    networkName: "Coston2",
  };
}

export function loadWorkerRuntimeConfig(
  environment: RuntimeEnvironment,
): WorkerRuntimeConfig {
  return {
    assetSymbol: "XRP",
    coston2DaLayerUrl: requiredUrl(environment, "COSTON2_DA_LAYER_URL"),
    coston2RpcUrl: requiredUrl(environment, "COSTON2_RPC_URL"),
    fdcVerifierApiKey: requiredValue(
      environment,
      "FDC_VERIFIER_API_KEY_TESTNET",
    ),
    fdcVerifierUrl: requiredUrl(environment, "FDC_VERIFIER_URL_TESTNET"),
    networkName: "Coston2",
    rfUsdSymbol: "rfUSD",
    sourceId: "testXRP",
  };
}
