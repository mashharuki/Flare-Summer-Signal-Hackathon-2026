import { type Address, asAddress } from "@reserveflow/shared";

export const COSTON2_CHAIN_ID = 114 as const;

export interface Eip1193Provider {
  request(input: {
    readonly method: string;
    readonly params?: readonly unknown[];
  }): Promise<unknown>;
}

export type WalletConnection =
  | { readonly status: "DISCONNECTED" }
  | {
      readonly account: Address;
      readonly chainId: typeof COSTON2_CHAIN_ID;
      readonly status: "CONNECTED";
    };

export class WebAppError extends Error {
  public constructor(
    readonly code:
      | "CONFIGURATION_ERROR"
      | "INVALID_WALLET"
      | "INVALID_XRPL_ADDRESS"
      | "WRONG_NETWORK",
    message: string,
  ) {
    super(message);
    this.name = "WebAppError";
  }
}

export interface AppShellView {
  readonly disclosure: string;
  readonly supportedReserve: {
    readonly asset: "XRP";
    readonly network: "XRPL Testnet";
  };
  readonly walletStatus: {
    readonly action: string;
    readonly kind: "CONFIGURATION_ERROR" | "CONNECTED" | "DISCONNECTED";
  };
}

/**
 * Produces the safe shell before any ReserveFlowCore or coordinator call.
 * It deliberately exposes only the Testnet MVP boundary.
 */
export function createAppShellView(input: {
  readonly configured?: boolean;
  readonly connection: WalletConnection;
}): AppShellView {
  const walletStatus = !input.configured
    ? { action: "Coston2設定を確認", kind: "CONFIGURATION_ERROR" as const }
    : input.connection.status === "CONNECTED"
      ? { action: "Coston2に接続済み", kind: "CONNECTED" as const }
      : { action: "Coston2ウォレットを接続", kind: "DISCONNECTED" as const };
  return {
    disclosure: "テスト用rfUSDのみを扱います。本番融資ではありません。",
    supportedReserve: { asset: "XRP", network: "XRPL Testnet" },
    walletStatus,
  };
}

export async function connectCoston2Wallet(
  provider: Eip1193Provider,
): Promise<Extract<WalletConnection, { readonly status: "CONNECTED" }>> {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
    throw new WebAppError(
      "INVALID_WALLET",
      "ウォレットからCoston2アカウントを取得できませんでした。",
    );
  }
  const chainId = await provider.request({ method: "eth_chainId" });
  if (chainId !== "0x72") {
    throw new WebAppError(
      "WRONG_NETWORK",
      "Coston2（chain ID 114）へ切り替えてから再試行してください。",
    );
  }
  try {
    return {
      account: asAddress(accounts[0]),
      chainId: COSTON2_CHAIN_ID,
      status: "CONNECTED",
    };
  } catch {
    throw new WebAppError(
      "INVALID_WALLET",
      "ウォレットから有効なEVMアドレスを取得できませんでした。",
    );
  }
}
