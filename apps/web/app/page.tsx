"use client";

import { useMemo, useState } from "react";
import { isValidClassicAddress } from "xrpl";

import {
  connectCoston2Wallet,
  createAppShellView,
  type Eip1193Provider,
  type WalletConnection,
} from "../src/app-shell.js";
import { validateXrplTestnetAddress } from "../src/attestation-timeline.js";

declare global {
  interface Window {
    readonly ethereum?: Eip1193Provider;
  }
}

const TIMELINE = [
  ["01", "必要なC2FLR feeを確認"],
  ["02", "ウォレットでFDC申請に署名"],
  ["03", "FDCラウンドの確定を待機"],
  ["04", "proofを取得"],
  ["05", "ReserveFlowCoreへ最終提出"],
] as const;

export default function ReserveFlowPage() {
  const [connection, setConnection] = useState<WalletConnection>({
    status: "DISCONNECTED",
  });
  const [walletMessage, setWalletMessage] = useState("");
  const [xrplAddress, setXrplAddress] = useState("");
  const [addressMessage, setAddressMessage] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const configured = Boolean(
    process.env.NEXT_PUBLIC_ATTESTATION_WORKER_URL &&
      process.env.NEXT_PUBLIC_COSTON2_RPC_URL,
  );
  const shell = useMemo(
    () => createAppShellView({ configured, connection }),
    [configured, connection],
  );

  const connectWallet = async () => {
    if (!window.ethereum) {
      setWalletMessage("EIP-1193対応ウォレットを接続してください。");
      return;
    }
    try {
      const nextConnection = await connectCoston2Wallet(window.ethereum);
      setConnection(nextConnection);
      setWalletMessage(`${nextConnection.account} をCoston2に接続しました。`);
    } catch (error) {
      setWalletMessage(
        error instanceof Error ? error.message : "接続できませんでした。",
      );
    }
  };

  const validateReserveAddress = () => {
    try {
      validateXrplTestnetAddress(xrplAddress, isValidClassicAddress);
      setAddressMessage(
        "XRPL Testnet address を確認しました。次に登録済みaccount IDで証明を準備します。",
      );
    } catch (error) {
      setAddressMessage(
        error instanceof Error ? error.message : "入力を確認してください。",
      );
    }
  };

  const transactionValid = /^0x?[0-9a-fA-F]{64}$/.test(transactionId);

  return (
    <main className="workbench">
      <aside className="signal-rail" aria-label="ReserveFlow Creditの対象範囲">
        <p className="wordmark">RESERVE{"//"}FLOW</p>
        <div className="rail-line" />
        <p className="rail-label">ATTESTATION WORKBENCH</p>
        <dl>
          <div>
            <dt>CHAIN</dt>
            <dd>Coston2 · 114</dd>
          </div>
          <div>
            <dt>RESERVE</dt>
            <dd>XRPL Testnet XRP</dd>
          </div>
          <div>
            <dt>MODE</dt>
            <dd>Test-only</dd>
          </div>
        </dl>
      </aside>

      <section className="console">
        <header className="topbar">
          <div>
            <p className="eyebrow">PROOF INTAKE</p>
            <h1>外部準備金を、検証待ちの事実として扱う。</h1>
          </div>
          <button
            className="wallet-button"
            onClick={connectWallet}
            type="button"
          >
            {connection.status === "CONNECTED"
              ? "Coston2 接続済み"
              : "Coston2 を接続"}
          </button>
        </header>

        <p className="disclosure" role="note">
          {shell.disclosure}
        </p>
        <p className="connection-state" aria-live="polite">
          {shell.walletStatus.action}
          {walletMessage ? ` — ${walletMessage}` : ""}
        </p>

        <div className="workspace-grid">
          <section
            className="panel reserve-panel"
            aria-labelledby="reserve-title"
          >
            <p className="eyebrow">SUPPORTED RESERVE</p>
            <h2 id="reserve-title">
              {shell.supportedReserve.network} / {shell.supportedReserve.asset}
            </h2>
            <label htmlFor="xrpl-address">XRPL classic address</label>
            <div className="input-row">
              <input
                id="xrpl-address"
                onChange={(event) => setXrplAddress(event.target.value.trim())}
                placeholder="r…"
                spellCheck="false"
                value={xrplAddress}
              />
              <button onClick={validateReserveAddress} type="button">
                形式を確認
              </button>
            </div>
            <p className="field-note" aria-live="polite">
              {addressMessage ||
                "登録済み・承認済みの準備金アカウントだけを使えます。"}
            </p>

            <label htmlFor="transaction-id">XRPL Payment transaction ID</label>
            <input
              id="transaction-id"
              onChange={(event) => setTransactionId(event.target.value.trim())}
              placeholder="0x…（64 hex）"
              spellCheck="false"
              value={transactionId}
            />
            <p className="field-note">
              {transactionId && !transactionValid
                ? "32-byteのXRPL transaction IDを入力してください。"
                : "Verifierは登録済みborrowerをproof ownerとして固定します。"}
            </p>
          </section>

          <section
            className="panel timeline-panel"
            aria-labelledby="timeline-title"
          >
            <p className="eyebrow">FDC PROGRESS</p>
            <h2 id="timeline-title">証明の進行</h2>
            <ol className="timeline">
              {TIMELINE.map(([number, label], index) => (
                <li className={index === 0 ? "active" : ""} key={number}>
                  <span>{number}</span>
                  <p>{label}</p>
                </li>
              ))}
            </ol>
            <p className="proof-caveat">
              proof ready
              は準備金更新ではありません。借入者ウォレットによるReserveFlowCore提出と、オンチェーンイベント確認後にだけ検証済みになります。
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}
