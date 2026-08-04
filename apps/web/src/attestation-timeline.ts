import type { Address, AttestationRecord, ProofId } from "@reserveflow/shared";

import { WebAppError } from "./app-shell.js";

export { WebAppError } from "./app-shell.js";

export interface PreparedXrpPaymentAttestation {
  readonly expiresAt: string;
  readonly id: ProofId;
  readonly proofOwner: Address;
  readonly requestBytes: `0x${string}`;
  readonly requestBytesHash: ProofId;
  readonly requiredFeeWei: bigint;
  readonly sourceId: "testXRP";
}

export type TimelineStepKind =
  | "FEE_READY"
  | "WALLET_SIGNATURE"
  | "WAITING_FINALIZATION"
  | "PROOF_READY"
  | "SUBMIT_TO_CORE";

export interface ReserveAttestationTimeline {
  readonly nextAction: {
    readonly kind: "RETRY" | "SUBMIT_TO_CORE" | "WAIT";
    readonly label: string;
  };
  readonly notice: string;
  readonly reserveUpdated: boolean;
  readonly steps: readonly {
    readonly kind: TimelineStepKind;
    readonly label: string;
    readonly requiredFeeWei?: bigint;
  }[];
}

export function validateXrplTestnetAddress(
  value: string,
  isValidClassicAddress: (address: string) => boolean,
): string {
  if (!isValidClassicAddress(value)) {
    throw new WebAppError(
      "INVALID_XRPL_ADDRESS",
      "XRPL Testnetの有効なclassic addressを入力してください。",
    );
  }
  return value;
}

export function buildFdcHubSubmission(
  prepared: PreparedXrpPaymentAttestation,
): { readonly requestBytes: `0x${string}`; readonly valueWei: bigint } {
  return {
    requestBytes: prepared.requestBytes,
    valueWei: prepared.requiredFeeWei,
  };
}

export function buildReserveAttestationTimeline(input: {
  readonly prepared?: PreparedXrpPaymentAttestation;
  readonly record: AttestationRecord;
}): ReserveAttestationTimeline {
  if (input.record.status === "FAILED") {
    return {
      nextAction: { kind: "RETRY", label: "証明を確認して再申請" },
      notice: input.record.failure?.message ?? "証明の検証に失敗しました。",
      reserveUpdated: false,
      steps: [],
    };
  }

  const steps: Array<ReserveAttestationTimeline["steps"][number]> = [];
  if (input.prepared) {
    steps.push({
      kind: "FEE_READY",
      label: "必要なC2FLR feeを確認",
      requiredFeeWei: input.prepared.requiredFeeWei,
    });
    steps.push({
      kind: "WALLET_SIGNATURE",
      label: "ウォレットでFDC申請に署名",
    });
  }
  steps.push({
    kind: "WAITING_FINALIZATION",
    label: "FDCラウンドの確定を待機",
  });
  if (
    input.record.status === "PROOF_READY" ||
    input.record.status === "VERIFIED"
  ) {
    steps.push({ kind: "PROOF_READY", label: "FDC proofを取得" });
    steps.push({
      kind: "SUBMIT_TO_CORE",
      label: "ウォレットでReserveFlowCoreへ証明を提出",
    });
  }
  if (input.record.status === "VERIFIED") {
    return {
      nextAction: { kind: "WAIT", label: "準備金更新を確認" },
      notice: "オンチェーンで証明を確認しました。",
      reserveUpdated: true,
      steps,
    };
  }
  if (input.record.status === "PROOF_READY") {
    return {
      nextAction: {
        kind: "SUBMIT_TO_CORE",
        label: "ウォレットでReserveFlowCoreへ証明を提出",
      },
      notice: "proofは未検証です。借入者ウォレットから最終提出してください。",
      reserveUpdated: false,
      steps,
    };
  }
  return {
    nextAction: { kind: "WAIT", label: "FDCの確定を待機" },
    notice: "証明はまだ準備中です。未検証のため準備金には反映されません。",
    reserveUpdated: false,
    steps,
  };
}
