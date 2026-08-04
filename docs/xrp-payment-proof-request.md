# XRPPayment proof（非カストディアル運用）

ReserveFlowでは、FDC request feeと`ReserveFlowCore.submitXrpPaymentProof`を**借入者の接続ウォレット**が署名します。Attestation Workerは秘密鍵を保持せず、Verifierへの準備リクエスト、FdcHub receipt照合、round finality確認、DA Layer proof取得だけを行います。

## Workerを起動する

```sh
set -a; source .env; set +a
pnpm --filter @reserveflow/attestation-worker serve:attestations
```

Workerには次だけを安全なSecret Storeから渡します。

```dotenv
COSTON2_RPC_URL=https://coston2-api.flare.network/ext/C/rpc
COSTON2_DA_LAYER_URL=https://ctn2-data-availability.flare.network
FDC_VERIFIER_URL_TESTNET=https://fdc-verifiers-testnet.flare.network
FDC_VERIFIER_API_KEY_TESTNET=...
RESERVE_FLOW_CORE_ADDRESS=0x...
ATTESTATION_DATABASE_PATH=./data/attestations.sqlite
ATTESTATION_ALLOWED_ORIGIN=https://your-web-app.vercel.app
```

`BORROWER_PRIVATE_KEY`、XRPL seed、rfUSDの承認権限はWorkerへ設定しません。

## 利用者のWebフロー

1. Coston2の借入者ウォレットを接続し、XRPL Testnet addressと検証済みPayment hashを入力する。
2. Webが署名済みの短期API認証を付けて`/attestations/prepare`を呼ぶ。
3. Webが受け取った`requestBytes`と**正確な**`requiredFeeWei`で、接続ウォレットから`FdcHub.requestAttestation`を送る。
4. WebがFdcHub transaction hashを`/submitted`へ渡し、Workerがreceipt・宛先・request bytes・feeを照合する。
5. round確定後、Webは`/refresh`を再試行する。`PROOF_READY`になったときだけ、接続ウォレットが`ReserveFlowCore.submitXrpPaymentProof`を送る。
6. WebがCore transaction hashを`/core-submitted`へ渡す。Workerは`ReserveUpdated`イベントを確認して`VERIFIED`にする。

FDC proofはDA Layerから得た未信頼データです。Coreが`FdcVerification.verifyXRPPayment`を通して検証するまで、準備金・借入可能額は更新しません。

`request:xrp-payment-proof`は旧来の鍵保持CLIのため廃止されています。
