"use client";

import {
  type ActivityEvent,
  type AttestationRecord,
  asAccountId,
  asAddress,
  asBasisPoints,
  asProofId,
  asTransactionHash,
  asWad,
  type CreditPosition,
  type RiskSnapshot,
} from "@reserveflow/shared";
import { useEffect, useMemo, useState } from "react";
import { isValidClassicAddress } from "xrpl";
import {
  buildActivityFeed,
  buildMonitoringSummary,
} from "../src/activity-monitor.js";
import {
  connectCoston2Wallet,
  createAppShellView,
  type Eip1193Provider,
  type WalletConnection,
} from "../src/app-shell.js";
import { validateXrplTestnetAddress } from "../src/attestation-timeline.js";
import {
  buildBorrowPreview,
  buildCreditDashboard,
  buildPriceDropPreview,
  buildRepaymentPreview,
  formatHealthFactor,
  formatRfUsd,
  formatUsd,
  parseRfUsd,
} from "../src/credit-experience.js";
import { DEFAULT_LOCALE, getCopy, isLocale, type Locale } from "../src/i18n.js";

declare global {
  interface Window {
    readonly ethereum?: Eip1193Provider;
  }
}

const TIMELINE_NUMBERS = ["01", "02", "03", "04", "05"] as const;

const DEMO_POSITION: CreditPosition = {
  borrower: asAddress("0x1111111111111111111111111111111111111111"),
  lastRiskSyncAt: 1_723_000_000n,
  openedAt: 1_722_000_000n,
  principalWad: asWad(30_000_000_000_000_000_000n),
  reserveAccountId: asAccountId(
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ),
  status: "HEALTHY",
};

const DEMO_RISK: RiskSnapshot = {
  adjustedReserveUsdWad: asWad(140_000_000_000_000_000_000n),
  availableCreditWad: asWad(40_000_000_000_000_000_000n),
  creditLimitWad: asWad(70_000_000_000_000_000_000n),
  grossReserveUsdWad: asWad(200_000_000_000_000_000_000n),
  healthFactorBps: asBasisPoints(23_333n),
  priceTimestamp: 1_723_000_000n,
  reserveTimestamp: 1_722_999_900n,
  status: "HEALTHY",
};

const DEMO_ACTIVITY: readonly ActivityEvent[] = [
  demoEvent("RESERVE_REGISTERED", 1_722_999_400n, "11"),
  demoEvent("PROOF_SUBMITTED", 1_722_999_500n, "22"),
  demoEvent("RESERVE_UPDATED", 1_722_999_600n, "33"),
  demoEvent("BORROWED", 1_722_999_700n, "44"),
  demoEvent("RISK_CHANGED", 1_722_999_800n, "55"),
  demoEvent("BORROWING_PAUSED", 1_722_999_900n, "66"),
  demoEvent("REPAID", 1_723_000_000n, "77"),
];

const DEMO_ATTESTATION: AttestationRecord = {
  accountId: DEMO_POSITION.reserveAccountId,
  createdAt: 1_722_999_500n,
  id: asProofId(`0x${"88".repeat(32)}`),
  requestBytesHash: asProofId(`0x${"88".repeat(32)}`),
  status: "PROOF_READY",
  txHash: asTransactionHash(`0x${"22".repeat(32)}`),
  updatedAt: 1_722_999_900n,
};

export default function ReserveFlowPage() {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [connection, setConnection] = useState<WalletConnection>({
    status: "DISCONNECTED",
  });
  const [walletMessage, setWalletMessage] = useState("");
  const [xrplAddress, setXrplAddress] = useState("");
  const [addressMessage, setAddressMessage] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [repayAmount, setRepayAmount] = useState("");
  const [priceDrop, setPriceDrop] = useState("25");
  const [showBorrowPreview, setShowBorrowPreview] = useState(false);
  const [showRepaymentPreview, setShowRepaymentPreview] = useState(false);
  const copy = getCopy(locale);
  const configured = Boolean(
    process.env.NEXT_PUBLIC_ATTESTATION_WORKER_URL &&
      process.env.NEXT_PUBLIC_COSTON2_RPC_URL,
  );
  const shell = useMemo(
    () => createAppShellView({ configured, connection }),
    [configured, connection],
  );
  const dashboard = useMemo(
    () => buildCreditDashboard({ position: DEMO_POSITION, risk: DEMO_RISK }),
    [],
  );
  const activityFeed = useMemo(
    () =>
      buildActivityFeed({
        activities: DEMO_ACTIVITY,
        borrower: DEMO_POSITION.borrower,
      }),
    [],
  );
  const monitoring = useMemo(
    () =>
      buildMonitoringSummary({
        attestation: DEMO_ATTESTATION,
        lastSyncedAt: 1_723_000_100n,
      }),
    [],
  );
  const borrowWad = parseRfUsd(borrowAmount);
  const repaymentWad = parseRfUsd(repayAmount);
  const priceDropBps = Number.parseInt(priceDrop, 10) * 100;
  const priceDropValid =
    Number.isInteger(priceDropBps) &&
    priceDropBps >= 0 &&
    priceDropBps <= 10_000;
  const priceDropPreview = buildPriceDropPreview({
    dropBps: asBasisPoints(BigInt(priceDropValid ? priceDropBps : 0)),
    simulatedRisk: {
      ...DEMO_RISK,
      availableCreditWad: asWad(5_000_000_000_000_000_000n),
      creditLimitWad: asWad(35_000_000_000_000_000_000n),
      healthFactorBps: asBasisPoints(11_666n),
      status: "WARNING",
    },
  });
  const borrowPreview = borrowWad
    ? buildBorrowPreview({
        amountWad: borrowWad,
        position: DEMO_POSITION,
        risk: DEMO_RISK,
      })
    : undefined;
  const repaymentPreview = repaymentWad
    ? buildRepaymentPreview({
        allowanceWad: asWad(0n),
        amountWad: repaymentWad,
        balanceWad: asWad(100_000_000_000_000_000_000n),
        position: DEMO_POSITION,
        risk: DEMO_RISK,
      })
    : undefined;

  useEffect(() => {
    const savedLocale = window.localStorage.getItem("reserveflow-locale");
    if (savedLocale && isLocale(savedLocale)) {
      setLocale(savedLocale);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem("reserveflow-locale", locale);
  }, [locale]);

  const connectWallet = async () => {
    if (!window.ethereum) {
      setWalletMessage(copy.walletMissing);
      return;
    }
    try {
      const nextConnection = await connectCoston2Wallet(window.ethereum);
      setConnection(nextConnection);
      setWalletMessage(copy.connectedWalletMessage(nextConnection.account));
    } catch (error) {
      setWalletMessage(
        error instanceof Error && locale === "ja"
          ? error.message
          : copy.connectionFailed,
      );
    }
  };

  const validateReserveAddress = () => {
    try {
      validateXrplTestnetAddress(xrplAddress, isValidClassicAddress);
      setAddressMessage(copy.addressConfirmed);
    } catch (error) {
      setAddressMessage(
        error instanceof Error && locale === "ja"
          ? error.message
          : copy.xrplInvalid,
      );
    }
  };

  const transactionValid = /^0x?[0-9a-fA-F]{64}$/.test(transactionId);

  return (
    <main className="workbench">
      <aside className="signal-rail" aria-label="ReserveFlow Credit">
        <p className="wordmark">RESERVE{"//"}FLOW</p>
        <div className="rail-line" />
        <p className="rail-label">ATTESTATION WORKBENCH</p>
        <dl>
          <div>
            <dt>{copy.chain}</dt>
            <dd>{copy.chainValue}</dd>
          </div>
          <div>
            <dt>{copy.reserve}</dt>
            <dd>XRPL Testnet XRP</dd>
          </div>
          <div>
            <dt>{copy.mode}</dt>
            <dd>{copy.testOnly}</dd>
          </div>
        </dl>
      </aside>

      <section className="console">
        <header className="topbar">
          <div>
            <p className="eyebrow">{copy.proofIntake}</p>
            <h1>{copy.hero}</h1>
          </div>
          <div className="topbar-actions">
            <fieldset className="language-switcher">
              <legend className="sr-only">Language</legend>
              <button
                aria-pressed={locale === "ja"}
                onClick={() => setLocale("ja")}
                type="button"
              >
                日本語
              </button>
              <button
                aria-pressed={locale === "en"}
                onClick={() => setLocale("en")}
                type="button"
              >
                EN
              </button>
            </fieldset>
            <button
              className="wallet-button"
              onClick={connectWallet}
              type="button"
            >
              {connection.status === "CONNECTED"
                ? copy.connectedWallet
                : copy.connectWallet}
            </button>
          </div>
        </header>

        <p className="disclosure" role="note">
          {copy.disclosure}
        </p>
        <p className="connection-state" aria-live="polite">
          {shell.walletStatus.kind === "CONFIGURATION_ERROR"
            ? copy.configState
            : connection.status === "CONNECTED"
              ? copy.connectedWallet
              : copy.connectWallet}
          {walletMessage ? ` — ${walletMessage}` : ""}
        </p>

        <div className="workspace-grid">
          <section
            className="panel reserve-panel"
            aria-labelledby="reserve-title"
          >
            <p className="eyebrow">{copy.supportedReserve}</p>
            <h2 id="reserve-title">
              {shell.supportedReserve.network} / {shell.supportedReserve.asset}
            </h2>
            <label htmlFor="xrpl-address">{copy.addressLabel}</label>
            <div className="input-row">
              <input
                id="xrpl-address"
                onChange={(event) => setXrplAddress(event.target.value.trim())}
                placeholder="r…"
                spellCheck="false"
                value={xrplAddress}
              />
              <button onClick={validateReserveAddress} type="button">
                {copy.formatCheck}
              </button>
            </div>
            <p className="field-note" aria-live="polite">
              {addressMessage || copy.addressFallback}
            </p>

            <label htmlFor="transaction-id">{copy.transactionId}</label>
            <input
              id="transaction-id"
              onChange={(event) => setTransactionId(event.target.value.trim())}
              placeholder="0x…（64 hex）"
              spellCheck="false"
              value={transactionId}
            />
            <p className="field-note">
              {transactionId && !transactionValid
                ? copy.invalidTransactionId
                : copy.verifierNotice}
            </p>
          </section>

          <section
            className="panel timeline-panel"
            aria-labelledby="timeline-title"
          >
            <p className="eyebrow">FDC PROGRESS</p>
            <h2 id="timeline-title">{copy.proofProgress}</h2>
            <ol className="timeline">
              {TIMELINE_NUMBERS.map((number, index) => (
                <li className={index === 0 ? "active" : ""} key={number}>
                  <span>{number}</span>
                  <p>{copy.timeline[index]}</p>
                </li>
              ))}
            </ol>
            <p className="proof-caveat">{copy.proofCaveat}</p>
          </section>
        </div>

        <section className="credit-ledger" aria-labelledby="credit-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{copy.creditSnapshot}</p>
              <h2 id="credit-title">
                {locale === "ja"
                  ? "信用枠は、検証済みデータの範囲だけ。"
                  : "Credit is limited to verified data."}
              </h2>
            </div>
            <p className="preview-label">{copy.showOnlySnapshot}</p>
          </div>
          <div className="metric-grid">
            <Metric
              label={copy.reserveValue}
              value={formatUsd(dashboard.metrics.grossReserveUsdWad)}
            />
            <Metric label={copy.riskAdjusted} value="30.00%" />
            <Metric
              label={copy.reserveAdjustedValue}
              value={formatUsd(dashboard.metrics.adjustedReserveUsdWad)}
            />
            <Metric label={copy.maxLtv} value="50.00%" />
            <Metric
              label={copy.creditLimit}
              value={formatRfUsd(dashboard.metrics.creditLimitWad)}
            />
            <Metric
              label={copy.availableCredit}
              value={formatRfUsd(dashboard.metrics.availableCreditWad)}
            />
            <Metric
              label={locale === "ja" ? "借入残高" : "Debt"}
              value={formatRfUsd(dashboard.metrics.principalWad)}
            />
            <Metric
              label={copy.health}
              value={formatHealthFactor(dashboard.metrics.healthFactorBps)}
            />
          </div>
          <div className="risk-strip" data-status={dashboard.risk.status}>
            <strong>{copy.risk[dashboard.risk.status].label}</strong>
            <p>{copy.risk[dashboard.risk.status].recovery}</p>
            <small>
              {copy.priceTimestamp}:{" "}
              {formatUnixTimestamp(dashboard.freshness.priceTimestamp, locale)}{" "}
              ／{copy.reserveTimestamp}:{" "}
              {formatUnixTimestamp(
                dashboard.freshness.reserveTimestamp,
                locale,
              )}
            </small>
          </div>
        </section>

        <div className="credit-actions">
          <section className="panel" aria-labelledby="simulation-title">
            <p className="eyebrow">{copy.simulationTitle}</p>
            <h2 id="simulation-title">{copy.priceDrop}</h2>
            <label htmlFor="price-drop">{copy.priceDropInput}</label>
            <input
              id="price-drop"
              inputMode="numeric"
              max="100"
              min="0"
              onChange={(event) => setPriceDrop(event.target.value)}
              value={priceDrop}
            />
            <p className="field-note">
              {priceDropValid
                ? copy.priceDropResult(
                    (priceDropPreview.dropBps / 100n).toString(),
                    formatRfUsd(priceDropPreview.creditLimitWad),
                    formatHealthFactor(priceDropPreview.healthFactorBps),
                    copy.risk[priceDropPreview.status].label,
                  )
                : copy.priceDropInvalid}
            </p>
            <p className="proof-caveat">{copy.simulationCaveat}</p>
          </section>

          <section className="panel" aria-labelledby="borrow-title">
            <p className="eyebrow">{copy.borrowPreview}</p>
            <h2 id="borrow-title">{copy.borrow}</h2>
            <label htmlFor="borrow-amount">{copy.borrowAmount}</label>
            <input
              id="borrow-amount"
              inputMode="decimal"
              onChange={(event) => {
                setBorrowAmount(event.target.value);
                setShowBorrowPreview(false);
              }}
              placeholder="0.000"
              value={borrowAmount}
            />
            <button
              className="action-button"
              disabled={!borrowWad}
              onClick={() => setShowBorrowPreview(true)}
              type="button"
            >
              {copy.borrowReview}
            </button>
            {showBorrowPreview && borrowPreview ? (
              <PreviewMessage
                message={
                  borrowPreview.allowed
                    ? copy.borrowReady(
                        formatRfUsd(borrowPreview.principalWad),
                        formatRfUsd(borrowPreview.availableCreditWad),
                        formatHealthFactor(borrowPreview.healthFactorBps),
                      )
                    : `${borrowPreview.blockingReason?.title} — ${borrowPreview.blockingReason?.recovery}`
                }
                tone={borrowPreview.allowed ? "ready" : "blocked"}
              />
            ) : null}
          </section>

          <section className="panel" aria-labelledby="repay-title">
            <p className="eyebrow">{copy.repayment}</p>
            <h2 id="repay-title">
              {locale === "ja" ? "rfUSDを返済する" : "Repay rfUSD"}
            </h2>
            <label htmlFor="repay-amount">{copy.repayAmount}</label>
            <input
              id="repay-amount"
              inputMode="decimal"
              onChange={(event) => {
                setRepayAmount(event.target.value);
                setShowRepaymentPreview(false);
              }}
              placeholder="0.000"
              value={repayAmount}
            />
            <button
              className="action-button secondary"
              disabled={!repaymentWad}
              onClick={() => setShowRepaymentPreview(true)}
              type="button"
            >
              {copy.repayReview}
            </button>
            {showRepaymentPreview && repaymentPreview ? (
              <PreviewMessage
                message={
                  repaymentPreview.action === "BLOCKED"
                    ? `${repaymentPreview.blockingReason.title} — ${repaymentPreview.blockingReason.recovery}`
                    : repaymentPreview.action === "APPROVE"
                      ? copy.approvalRequired(
                          formatRfUsd(repaymentPreview.principalWad),
                        )
                      : locale === "ja"
                        ? `返済後の借入残高: ${formatRfUsd(repaymentPreview.principalWad)} ／ 利用可能額: ${formatRfUsd(repaymentPreview.availableCreditWad)}`
                        : `After repayment: debt ${formatRfUsd(repaymentPreview.principalWad)} / available ${formatRfUsd(repaymentPreview.availableCreditWad)}`
                }
                tone={
                  repaymentPreview.action === "BLOCKED" ? "blocked" : "ready"
                }
              />
            ) : null}
          </section>
        </div>

        <section className="activity-monitor" aria-labelledby="activity-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ACTIVITY MONITOR</p>
              <h2 id="activity-title">{copy.activity.heading}</h2>
            </div>
            <p className="preview-label">{copy.activity.ownPosition}</p>
          </div>
          <div className="monitor-summary">
            <div>
              <span>{copy.activity.lastSynced}</span>
              <strong>
                {formatUnixTimestamp(monitoring.lastSyncedAt, locale)}
              </strong>
            </div>
            <div>
              <span>{copy.activity.attestation}</span>
              <strong>
                {monitoring.isVerified
                  ? copy.activity.outcome.CONFIRMED
                  : copy.activity.outcome.PENDING}
              </strong>
              <small>{monitoring.attestationStatus}</small>
            </div>
            <p>{copy.activity.snapshotNotice}</p>
          </div>
          {activityFeed.entries.length === 0 ? (
            <p className="empty-activity">{copy.activity.noEvents}</p>
          ) : (
            <ol className="activity-list">
              {activityFeed.entries.map((entry) => (
                <li key={`${entry.kind}-${entry.occurredAt}`}>
                  <span className={`outcome ${entry.outcome.toLowerCase()}`}>
                    {copy.activity.outcome[entry.outcome]}
                  </span>
                  <div>
                    <strong>{copy.activity.kind[entry.kind]}</strong>
                    <small>
                      {formatUnixTimestamp(entry.occurredAt, locale)}
                    </small>
                  </div>
                  <code title={entry.transactionHash}>
                    {entry.transactionHash
                      ? formatTransactionHash(entry.transactionHash)
                      : "—"}
                  </code>
                </li>
              ))}
            </ol>
          )}
        </section>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PreviewMessage({
  message,
  tone,
}: {
  readonly message: string;
  readonly tone: "blocked" | "ready";
}) {
  return <p className={`transaction-preview ${tone}`}>{message}</p>;
}

function formatUnixTimestamp(value: bigint, locale: Locale): string {
  return new Date(Number(value) * 1_000).toLocaleString(
    locale === "ja" ? "ja-JP" : "en-US",
    {
      dateStyle: "short",
      timeStyle: "short",
    },
  );
}

function formatTransactionHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function demoEvent(
  kind: ActivityEvent["kind"],
  occurredAt: bigint,
  byte: string,
): ActivityEvent {
  return {
    details: { borrower: DEMO_POSITION.borrower },
    kind,
    occurredAt,
    txHash: asTransactionHash(`0x${byte.repeat(32)}`),
  };
}
