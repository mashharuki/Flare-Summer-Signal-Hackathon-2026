import { asAddress } from "@reserveflow/shared";
import { describe, expect, it, vi } from "vitest";

import {
  connectCoston2Wallet,
  createAppShellView,
  WebAppError,
} from "./../src/app-shell.js";

const BORROWER = asAddress("0x1111111111111111111111111111111111111111");

describe("Coston2 app shell", () => {
  it("shows the test-rfUSD disclosure and a recovery state when configuration is absent", () => {
    const view = createAppShellView({ connection: { status: "DISCONNECTED" } });

    expect(view.disclosure).toContain("テスト用rfUSD");
    expect(view.disclosure).toContain("本番融資ではありません");
    expect(view.supportedReserve).toEqual({
      asset: "XRP",
      network: "XRPL Testnet",
    });
    expect(view.walletStatus).toEqual({
      action: "Coston2設定を確認",
      kind: "CONFIGURATION_ERROR",
    });
  });

  it("connects only after the wallet reports Coston2", async () => {
    const provider = {
      request: vi
        .fn()
        .mockResolvedValueOnce([BORROWER])
        .mockResolvedValueOnce("0x72"),
    };

    await expect(connectCoston2Wallet(provider)).resolves.toEqual({
      account: BORROWER,
      chainId: 114,
      status: "CONNECTED",
    });
  });

  it("rejects every non-Coston2 wallet before app clients can be used", async () => {
    const provider = {
      request: vi
        .fn()
        .mockResolvedValueOnce([BORROWER])
        .mockResolvedValueOnce("0x1"),
    };

    await expect(connectCoston2Wallet(provider)).rejects.toEqual(
      new WebAppError(
        "WRONG_NETWORK",
        "Coston2（chain ID 114）へ切り替えてから再試行してください。",
      ),
    );
  });
});
