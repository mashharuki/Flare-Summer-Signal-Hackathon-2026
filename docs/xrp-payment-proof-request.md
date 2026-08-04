# XRPPayment proof 申請コマンド

`request:xrp-payment-proof` は、検証済みの XRPL Testnet Payment を FDC `XRPPayment` として申請し、FDC round の確定と DA Layer proof の生成を待ってから、`ReserveFlowCore.submitXrpPaymentProof` へ提出します。

このコマンドは Coston2 の C2FLR を request fee と gas に使い、ReserveFlow の状態を更新します。署名・ブロードキャストを行うため、必要な値がすべて確認できた場合だけ実行してください。

## 事前条件

- 送金が XRPL Testnet で `validated` / `tesSUCCESS` になっていること。
- Payment から少なくとも 3 XRPL ledger が確定していること。
- Coston2 に `ReserveFlowCore` をデプロイ済みで、borrower を承認済みにしていること。
- `RESERVE_FLOW_XRPL_ADDRESS` が、borrower に登録済みの準備金アカウントであること。
- `BORROWER_PRIVATE_KEY` の Coston2 address が、その reserve account の borrower であること。キーはローカルのみで管理し、チャット・Git・ログへ貼り付けないこと。

## 実行

デプロイ出力から `RESERVE_FLOW_CORE_ADDRESS` を設定します。今回の入金なら、外部準備金アドレスは受取先の `r...` アドレスであり、方向は `incoming` です。

```sh
export COSTON2_RPC_URL='https://coston2-api.flare.network/ext/C/rpc'
export COSTON2_DA_LAYER_URL='https://ctn2-data-availability.flare.network'
export FDC_VERIFIER_URL_TESTNET='https://fdc-verifiers-testnet.flare.network'
export FDC_VERIFIER_API_KEY_TESTNET='00000000-0000-0000-0000-000000000000'

export BORROWER_PRIVATE_KEY='0x...'
export RESERVE_FLOW_CORE_ADDRESS='0x...'
export RESERVE_FLOW_XRPL_ADDRESS='r...'
export RESERVE_FLOW_PAYMENT_DIRECTION='incoming'
export FDC_XRP_PAYMENT_TRANSACTION_ID='0x...'

export FDC_XRP_PAYMENT_CONFIRM='SUBMIT_COSTON2_XRP_PAYMENT_PROOF'
pnpm --filter @reserveflow/attestation-worker request:xrp-payment-proof
```

`FDC_XRP_PAYMENT_CONFIRM` がない、または値が異なる場合、Verifier への準備リクエスト、FDC fee の支払い、proof 提出はいずれも開始しません。

## 結果と安全性

成功時は次だけを表示します。

- FDC attestation request の Coston2 transaction hash
- ReserveFlow proof 提出の Coston2 transaction hash
- FDC voting round ID

コマンドは Coston2 chain ID を `114` と照合し、FDC Hub、fee configuration、Relay、FDC verification、Flare Systems Manager を Contract Registry から解決します。FDC response の transaction ID、proof owner、`testXRP` source、成功 status、XRPL address hash と指定方向がすべて一致しなければ、ReserveFlow への提出前に停止します。

FDC round または DA Layer proof が timeout になっても、FDC request を自動再送しません。オンチェーン request hash を確認してから、同じ request を追跡するか判断してください。

## 既存 request の再開

FDC request を送信した後に DA Layer 取得が失敗した場合、同じコマンドをそのまま再実行すると追加の request fee が発生します。出力された `attestationRequestTransactionHash`、または Coston2 Explorer で確認した request transaction hash を指定して再開してください。

```sh
export FDC_XRP_PAYMENT_EXISTING_REQUEST_TRANSACTION_HASH='0x...'
pnpm --filter @reserveflow/attestation-worker request:xrp-payment-proof
```

この場合、コマンドは transaction の宛先が FdcHub であること、送信済み request bytes が現在の XRPPayment request と完全一致すること、receipt が成功していることを確認してから、送信 block の voting round で proof 取得を再開します。FDC request fee は再送しません。
