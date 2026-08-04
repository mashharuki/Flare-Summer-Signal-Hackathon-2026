export const SUPPORTED_LOCALES = ["ja", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ja";

interface Copy {
  readonly activity: ActivityCopy;
  readonly addressConfirmed: string;
  readonly addressFallback: string;
  readonly addressLabel: string;
  readonly approvalRequired: (principal: string) => string;
  readonly availableCredit: string;
  readonly borrow: string;
  readonly borrowAmount: string;
  readonly borrowPreview: string;
  readonly borrowReady: (
    principal: string,
    available: string,
    health: string,
  ) => string;
  readonly borrowReview: string;
  readonly chain: string;
  readonly chainValue: string;
  readonly configState: string;
  readonly connectWallet: string;
  readonly connectedWallet: string;
  readonly connectedWalletMessage: (account: string) => string;
  readonly connectionFailed: string;
  readonly creditLimit: string;
  readonly creditSnapshot: string;
  readonly disclosure: string;
  readonly formatCheck: string;
  readonly health: string;
  readonly hero: string;
  readonly invalidTransactionId: string;
  readonly maxLtv: string;
  readonly mode: string;
  readonly priceDrop: string;
  readonly priceDropInput: string;
  readonly priceDropInvalid: string;
  readonly priceDropResult: (
    percent: string,
    limit: string,
    health: string,
    status: string,
  ) => string;
  readonly priceTimestamp: string;
  readonly proofCaveat: string;
  readonly proofIntake: string;
  readonly proofProgress: string;
  readonly repayment: string;
  readonly repayAmount: string;
  readonly repayPreview: string;
  readonly repayReview: string;
  readonly reserve: string;
  readonly reserveAdjustedValue: string;
  readonly reserveLabel: string;
  readonly reserveTimestamp: string;
  readonly reserveValue: string;
  readonly risk: Readonly<Record<RiskStatusKey, RiskCopy>>;
  readonly riskAdjusted: string;
  readonly showOnlySnapshot: string;
  readonly simulationCaveat: string;
  readonly simulationTitle: string;
  readonly supportedReserve: string;
  readonly testOnly: string;
  readonly timeline: readonly string[];
  readonly transactionFallback: string;
  readonly transactionId: string;
  readonly verifierNotice: string;
  readonly walletMissing: string;
  readonly xrplInvalid: string;
}

interface ActivityCopy {
  readonly attestation: string;
  readonly heading: string;
  readonly kind: Readonly<Record<ActivityKindKey, string>>;
  readonly lastSynced: string;
  readonly noEvents: string;
  readonly outcome: Readonly<Record<ActivityOutcomeKey, string>>;
  readonly ownPosition: string;
  readonly snapshotNotice: string;
  readonly transaction: string;
}

type ActivityKindKey =
  | "BORROWED"
  | "BORROWING_PAUSED"
  | "PROOF_REJECTED"
  | "PROOF_SUBMITTED"
  | "PROOF_VERIFIED"
  | "REPAID"
  | "RESERVE_REGISTERED"
  | "RESERVE_UPDATED"
  | "RISK_CHANGED";

type ActivityOutcomeKey = "CONFIRMED" | "PAUSED" | "PENDING" | "REJECTED";

type RiskStatusKey =
  | "FROZEN"
  | "HEALTHY"
  | "MARGIN_CALL"
  | "PRICE_STALE"
  | "RESERVE_STALE"
  | "WARNING";

interface RiskCopy {
  readonly label: string;
  readonly recovery: string;
}

const copy: Readonly<Record<Locale, Copy>> = {
  ja: {
    activity: {
      attestation: "証明状態",
      heading: "Activity と監視",
      kind: {
        BORROWED: "rfUSDを借入",
        BORROWING_PAUSED: "新規借入を停止",
        PROOF_REJECTED: "証明を拒否",
        PROOF_SUBMITTED: "証明を申請",
        PROOF_VERIFIED: "証明を検証",
        REPAID: "rfUSDを返済",
        RESERVE_REGISTERED: "準備金を登録",
        RESERVE_UPDATED: "準備金を更新",
        RISK_CHANGED: "リスク状態を更新",
      },
      lastSynced: "最終同期",
      noEvents: "このポジションのイベントはまだありません。",
      outcome: {
        CONFIRMED: "確定",
        PAUSED: "停止中",
        PENDING: "検証待ち",
        REJECTED: "拒否",
      },
      ownPosition: "接続中のポジションのみ",
      snapshotNotice:
        "この表示は最後に取得したスナップショットであり、リアルタイム表示ではありません。",
      transaction: "トランザクション",
    },
    addressConfirmed:
      "XRPL Testnet address を確認しました。次に登録済みaccount IDで証明を準備します。",
    addressFallback: "登録済み・承認済みの準備金アカウントだけを使えます。",
    addressLabel: "XRPL classic address",
    approvalRequired: (principal) =>
      `先にrfUSD利用承認が必要です。承認後の借入残高: ${principal}`,
    availableCredit: "利用可能額",
    borrow: "rfUSDを借りる",
    borrowAmount: "借入額（rfUSD）",
    borrowPreview: "借入プレビュー",
    borrowReady: (principal, available, health) =>
      `送信後の借入残高: ${principal} ／ 利用可能額: ${available} ／ Health: ${health}`,
    borrowReview: "借入内容を確認",
    chain: "CHAIN",
    chainValue: "Coston2 · 114",
    configState: "Coston2設定を確認",
    connectWallet: "Coston2 を接続",
    connectedWallet: "Coston2 接続済み",
    connectedWalletMessage: (account) => `${account} をCoston2に接続しました。`,
    connectionFailed: "接続できませんでした。",
    creditLimit: "信用枠",
    creditSnapshot: "CREDIT SNAPSHOT",
    disclosure: "テスト用rfUSDのみを扱います。本番融資ではありません。",
    formatCheck: "形式を確認",
    health: "Health",
    hero: "外部準備金を、検証待ちの事実として扱う。",
    invalidTransactionId: "32-byteのXRPL transaction IDを入力してください。",
    maxLtv: "最大LTV",
    mode: "MODE",
    priceDrop: "価格下落を想定",
    priceDropInput: "XRP価格の下落率（%）",
    priceDropInvalid: "0から100までの整数を入力してください。",
    priceDropResult: (percent, limit, health, status) =>
      `${percent}%下落時: 信用枠 ${limit}、Health ${health}、${status}`,
    priceTimestamp: "価格",
    proofCaveat:
      "proof ready は準備金更新ではありません。借入者ウォレットによるReserveFlowCore提出と、オンチェーンイベント確認後にだけ検証済みになります。",
    proofIntake: "PROOF INTAKE",
    proofProgress: "証明の進行",
    repayment: "返済",
    repayAmount: "返済額（rfUSD）",
    repayPreview: "返済",
    repayReview: "返済内容を確認",
    reserve: "RESERVE",
    reserveAdjustedValue: "リスク調整後価値",
    reserveLabel: "準備金証明",
    reserveTimestamp: "準備金証明",
    reserveValue: "準備金評価額",
    risk: {
      FROZEN: {
        label: "アカウント凍結 — 新規借入を停止中",
        recovery:
          "返済は継続できます。解除はRisk Adminの確認後に反映されます。",
      },
      HEALTHY: {
        label: "健全 — 新規借入が可能です",
        recovery: "価格と準備金証明の鮮度を維持してください。",
      },
      MARGIN_CALL: {
        label: "マージンコール — 新規借入を停止中",
        recovery: "返済または担保リスクの低減を行ってください。",
      },
      PRICE_STALE: {
        label: "価格の鮮度切れ — 新規借入を停止中",
        recovery: "価格データの更新を待ってから再試行してください。",
      },
      RESERVE_STALE: {
        label: "準備金証明の鮮度切れ — 新規借入を停止中",
        recovery: "新しい準備金証明を完了してから再試行してください。",
      },
      WARNING: {
        label: "警告 — 新規借入を停止中",
        recovery: "返済または準備金の更新で健全性を回復してください。",
      },
    },
    riskAdjusted: "Haircut",
    showOnlySnapshot: "環境未設定時は表示用スナップショットです",
    simulationCaveat: "この試算はオンチェーン状態を変更しません。",
    simulationTitle: "READ-ONLY SIMULATION",
    supportedReserve: "SUPPORTED RESERVE",
    testOnly: "テスト専用",
    timeline: [
      "必要なC2FLR feeを確認",
      "ウォレットでFDC申請に署名",
      "FDCラウンドの確定を待機",
      "proofを取得",
      "ReserveFlowCoreへ最終提出",
    ],
    transactionFallback:
      "Verifierは登録済みborrowerをproof ownerとして固定します。",
    transactionId: "XRPL Payment transaction ID",
    verifierNotice: "Verifierは登録済みborrowerをproof ownerとして固定します。",
    walletMissing: "EIP-1193対応ウォレットを接続してください。",
    xrplInvalid: "XRPL Testnetの有効なclassic addressを入力してください。",
  },
  en: {
    activity: {
      attestation: "Attestation status",
      heading: "Activity & monitoring",
      kind: {
        BORROWED: "rfUSD borrowed",
        BORROWING_PAUSED: "Borrowing paused",
        PROOF_REJECTED: "Proof rejected",
        PROOF_SUBMITTED: "Proof submitted",
        PROOF_VERIFIED: "Proof verified",
        REPAID: "rfUSD repaid",
        RESERVE_REGISTERED: "Reserve registered",
        RESERVE_UPDATED: "Reserve updated",
        RISK_CHANGED: "Risk state updated",
      },
      lastSynced: "Last synchronized",
      noEvents: "There are no events for this position yet.",
      outcome: {
        CONFIRMED: "Confirmed",
        PAUSED: "Paused",
        PENDING: "Awaiting verification",
        REJECTED: "Rejected",
      },
      ownPosition: "Connected position only",
      snapshotNotice:
        "This is the last fetched snapshot, not a realtime display.",
      transaction: "Transaction",
    },
    addressConfirmed:
      "XRPL Testnet address confirmed. Prepare proof with the registered account ID next.",
    addressFallback:
      "Only registered and approved reserve accounts can be used.",
    addressLabel: "XRPL classic address",
    approvalRequired: (principal) =>
      `rfUSD approval is required first. Debt after approval: ${principal}`,
    availableCredit: "Available credit",
    borrow: "Borrow rfUSD",
    borrowAmount: "Borrow amount (rfUSD)",
    borrowPreview: "Borrow preview",
    borrowReady: (principal, available, health) =>
      `After submission: debt ${principal} / available ${available} / health ${health}`,
    borrowReview: "Review borrow",
    chain: "CHAIN",
    chainValue: "Coston2 · 114",
    configState: "Check Coston2 configuration",
    connectWallet: "Connect Coston2",
    connectedWallet: "Coston2 connected",
    connectedWalletMessage: (account) => `${account} connected to Coston2.`,
    connectionFailed: "Could not connect wallet.",
    creditLimit: "Credit limit",
    creditSnapshot: "CREDIT SNAPSHOT",
    disclosure: "Test rfUSD only. This is not production lending.",
    formatCheck: "Check format",
    health: "Health",
    hero: "Treat external reserves as facts awaiting verification.",
    invalidTransactionId: "Enter a 32-byte XRPL transaction ID.",
    maxLtv: "Max LTV",
    mode: "MODE",
    priceDrop: "Model a price drop",
    priceDropInput: "XRP price drop (%)",
    priceDropInvalid: "Enter a whole number from 0 to 100.",
    priceDropResult: (percent, limit, health, status) =>
      `At a ${percent}% drop: limit ${limit}, health ${health}, ${status}`,
    priceTimestamp: "Price",
    proofCaveat:
      "Proof ready does not update reserves. It becomes verified only after the borrower submits to ReserveFlowCore and the on-chain event is confirmed.",
    proofIntake: "PROOF INTAKE",
    proofProgress: "Proof progress",
    repayment: "REPAYMENT",
    repayAmount: "Repay amount (rfUSD)",
    repayPreview: "Repayment",
    repayReview: "Review repayment",
    reserve: "RESERVE",
    reserveAdjustedValue: "Risk-adjusted value",
    reserveLabel: "Reserve proof",
    reserveTimestamp: "Reserve proof",
    reserveValue: "Reserve value",
    risk: {
      FROZEN: {
        label: "Account frozen — borrowing stopped",
        recovery:
          "Repayment remains available. A Risk Admin review is required to unfreeze.",
      },
      HEALTHY: {
        label: "Healthy — borrowing available",
        recovery: "Keep price and reserve proof data fresh.",
      },
      MARGIN_CALL: {
        label: "Margin call — borrowing stopped",
        recovery: "Repay or reduce reserve risk.",
      },
      PRICE_STALE: {
        label: "Price stale — borrowing stopped",
        recovery: "Wait for a fresh price update before retrying.",
      },
      RESERVE_STALE: {
        label: "Reserve proof stale — borrowing stopped",
        recovery: "Complete a new reserve proof before retrying.",
      },
      WARNING: {
        label: "Warning — borrowing stopped",
        recovery: "Repay or update reserves to restore health.",
      },
    },
    riskAdjusted: "Haircut",
    showOnlySnapshot: "Display snapshot while runtime configuration is absent",
    simulationCaveat: "This simulation does not change on-chain state.",
    simulationTitle: "READ-ONLY SIMULATION",
    supportedReserve: "SUPPORTED RESERVE",
    testOnly: "Test-only",
    timeline: [
      "Check the required C2FLR fee",
      "Sign the FDC request in your wallet",
      "Wait for FDC round finalization",
      "Retrieve proof",
      "Submit to ReserveFlowCore",
    ],
    transactionFallback:
      "The verifier fixes the registered borrower as proof owner.",
    transactionId: "XRPL Payment transaction ID",
    verifierNotice:
      "The verifier fixes the registered borrower as proof owner.",
    walletMissing: "Connect an EIP-1193 compatible wallet.",
    xrplInvalid: "Enter a valid XRPL Testnet classic address.",
  },
};

export function getCopy(locale: Locale): Copy {
  return copy[locale];
}

export function isLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}
