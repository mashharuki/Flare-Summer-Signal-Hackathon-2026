# XRPL Testnet送金スクリプト

`apps/attestation-worker/scripts/send-xrpl-test-payment.ts`は、ReserveFlowの入金proof用に、XRPL TestnetでネイティブXRP Paymentを送信するローカル専用CLIです。

## 安全境界

- 接続先はXRPL Testnetの`wss://s.altnet.rippletest.net:51233`に固定されています。
- Mainnet XRPを送信できません。
- 送信元seedは`XRPL_TESTNET_SENDER_SEED`からだけ読み込み、標準出力・ログ・設定ファイルには出力しません。
- `XRPL_TESTNET_CONFIRM=SEND_TEST_XRP`を明示しなければ送信しません。
- CLIは`validated`かつ`tesSUCCESS`のPaymentだけを成功として、FDC申請に使うトランザクションハッシュを返します。

XRPL Testnet Faucetで作成・資金供給した送信元アカウントを使ってください。Testnet XRPはMainnet XRPと別物です。[XRPL Faucet](https://xrpl.org/resources/dev-tools/xrp-faucets)

## 実行

送信元seedはローカルshellにのみ設定します。絶対にチャット、Git、`.env.example`へ貼り付けないでください。

```sh
export XRPL_TESTNET_SENDER_SEED='s...'
export XRPL_TESTNET_DESTINATION='rELiPixQHM5NLgMqXovBmwZCYw6tFKZxh8'
export XRPL_TESTNET_AMOUNT_XRP='2'
export XRPL_TESTNET_CONFIRM='SEND_TEST_XRP'

pnpm --filter @reserveflow/attestation-worker send:xrpl-test-payment
```

成功すると次の形式で、validated済みのハッシュが表示されます。

```json
{
  "amountDrops": "2000000",
  "destination": "rELiPixQHM5NLgMqXovBmwZCYw6tFKZxh8",
  "network": "XRPL Testnet",
  "transactionHash": "<64桁の16進ハッシュ>"
}
```

この`transactionHash`を次のFDC `XRPPayment`申請に使用します。FDCのMerkle proofがCoston2上で検証されるまで、送金はReserveFlowの準備金残高へ反映されません。

## 失敗時

- `Set XRPL_TESTNET_CONFIRM=SEND_TEST_XRP`: 明示確認がありません。意図したTest XRP送金であることを確認して値を設定してください。
- `Missing required environment variable`: seedまたは宛先が未設定です。
- `validated tesSUCCESS`: 送金が確定しなかった、またはXRPLの実行結果が成功ではありません。Faucet残高、宛先、XRPL Testnetの状態を確認して新しい送金を作成してください。
