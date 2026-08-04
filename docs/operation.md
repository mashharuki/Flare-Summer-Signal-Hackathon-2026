# ReserveFlow Credit — Coston2 デモ

ReserveFlow Creditは、XRPL Testnet上のXRP支払いをFlare Data Connector（FDC）で検証し、Coston2上でテスト用rfUSDの借入可能額を計算するデモです。

> **安全境界**: このリポジトリはCoston2、XRPL Testnet、testXRP、テスト用rfUSDだけを対象にします。本番融資・実資産・法定通貨・mainnetは扱いません。秘密鍵、シード、Verifier APIキーをコミット、ログ、チャットへ貼り付けないでください。

## このデモが証明するもの・しないもの

- FDCの`XRPPayment` attestationは、指定したXRPL支払いトランザクションの証明です。継続的な口座残高や準備金総額の証明ではありません。
- Workerが取得したproofは未信頼データです。`ReserveFlowCore`が`FdcVerification`を通してオンチェーンで検証して初めて準備金更新になります。
- 新規借入には、オンチェーンで検証済みのfreshなFDC準備金proof、freshなFTSO価格、`HEALTHY`なリスク状態、借入者承認、借入停止なしが必要です。価格または準備金がstaleの場合は借入できませんが、返済は可能です。
- UIのスナップショットはリアルタイム残高ではありません。proofが「取得済み」でも、借入者がオンチェーンへ提出して確認されるまではリスク状態を更新しません。

## 前提条件

- Node.js とpnpm 10.33.0
- Foundry（コントラクトのビルド、テスト、デプロイ用）
- Coston2でガスとFDCリクエスト手数料を払える少量のC2FLR
- XRPL Testnetアカウントと、支払いを送る場合だけそのシード
- FDC Testnet Verifier APIキー（サーバー側Worker専用）

依存関係とローカル設定を用意します。

```sh
pnpm install
cp .env.example .env
cp apps/web/.env.local.example apps/web/.env.local
```

`.env`と`apps/web/.env.local`にはローカルだけで値を設定し、Gitへ追加しません。フロントエンドには`apps/web/.env.local.example`を使い、`NEXT_PUBLIC_`以外の秘密情報を置かないでください。主な変数は次のとおりです。

| 用途 | 必要な変数 |
| --- | --- |
| Web表示・ウォレット送信 | `NEXT_PUBLIC_COSTON2_RPC_URL`, `NEXT_PUBLIC_ATTESTATION_WORKER_URL`, Core / FdcHub / Vault / rfUSD の公開アドレス |
| FDC proof取得 | `COSTON2_RPC_URL`, `COSTON2_DA_LAYER_URL`, `FDC_VERIFIER_URL_TESTNET`, `FDC_VERIFIER_API_KEY_TESTNET` |
| Coston2デプロイ | `DEPLOYER_PRIVATE_KEY`, `DEMO_BORROWER_ADDRESS`, `DEPLOYMENT_OUTPUT_PATH` |
| Worker HTTP API | `RESERVE_FLOW_CORE_ADDRESS`, `ATTESTATION_DATABASE_PATH`, `ATTESTATION_WORKER_PORT`, `ATTESTATION_ALLOWED_ORIGIN` |
| XRPL Testnet送金（任意） | `XRPL_TESTNET_SENDER_SEED`, `XRPL_TESTNET_DESTINATION`, `XRPL_TESTNET_AMOUNT_XRP` |

`FDC_VERIFIER_API_KEY_TESTNET`はブラウザ公開変数にせず、Workerを動かす端末だけに置いてください。

## コンポーネント別の起動・デプロイ

### スマートコントラクト（Coston2）

コントラクトはCoston2（chain ID `114`）だけへデプロイします。`DEPLOYER_PRIVATE_KEY`はC2FLRを持つ専用のテスト用デプロイヤーに限定してください。

```sh
set -a; source .env; set +a
pnpm --filter @reserveflow/contracts typecheck
pnpm --filter @reserveflow/contracts test
pnpm --filter @reserveflow/contracts deploy:coston2
```

`deploy:coston2`はブロードキャストするため、実行前にRPC URL、chain ID、デプロイヤー、`DEMO_BORROWER_ADDRESS`を確認します。成功後は`packages/contracts/deployments/coston2.local.json`の今回の出力だけを参照し、`ReserveFlowCore`アドレスをWorkerの`RESERVE_FLOW_CORE_ADDRESS`へ設定します。過去のデプロイ出力やサンプルアドレスを再利用しません。デプロイ後はread-only smokeと、準備金アカウントの登録・承認を確認してからproof申請へ進みます。

### Attestation Worker（バックエンド処理）

`apps/attestation-worker`は非カストディアルHTTP APIです。Verifier APIキーを保持してFDC requestを準備し、ユーザー署名済みFdcHub receiptを照合して、DA Layer proofを返します。FdcHub feeとCoreへのproof提出はWebの接続ウォレットだけが署名します。

WorkerはVercelではなく、永続volumeを持つNodeコンテナとしてデプロイします。`ATTESTATION_DATABASE_PATH`は再起動後も同じvolume上を指す必要があります。

```sh
set -a; source .env; set +a

# 読み取り専用のCoston2/FDC接続確認
export COSTON2_FDC_SMOKE_CONFIRM='READ_COSTON2_FDC'
pnpm --filter @reserveflow/attestation-worker smoke:coston2-fdc

# HTTP APIを起動（秘密鍵は不要）
export ATTESTATION_DATABASE_PATH='./data/attestations.sqlite'
export ATTESTATION_ALLOWED_ORIGIN='http://localhost:3000'
pnpm --filter @reserveflow/attestation-worker serve:attestations
```

Workerには`COSTON2_RPC_URL`、`COSTON2_DA_LAYER_URL`、`FDC_VERIFIER_URL_TESTNET`、`FDC_VERIFIER_API_KEY_TESTNET`、`RESERVE_FLOW_CORE_ADDRESS`、永続DBパス、許可OriginだけをSecret Storeから渡します。APIはborrowerの短期EIP-191署名を検証し、Core上のborrowerとの一致を確認します。ログにシード、秘密鍵、APIキーを出力しません。

### フロントエンド（ローカル起動・Vercel）

ローカルでは、公開設定だけを含むテンプレートから環境ファイルを作成します。

```sh
cp apps/web/.env.local.example apps/web/.env.local
pnpm --filter @reserveflow/web dev
```

Webは`http://localhost:3000`で起動します。Worker URLが空の場合は、安全な未接続デモ状態を表示します。ウォレットと接続する場合はCoston2（chain ID `114`）だけを使用してください。

`apps/web`はVercel向けに設定済みです。GitリポジトリをVercelへImportし、次の値でProjectを作成してください。

| 設定 | 値 |
| --- | --- |
| Framework Preset | `Next.js` |
| Root Directory | `apps/web` |
| Install Command | `apps/web/vercel.json`の設定を使用 |
| Build Command | `apps/web/vercel.json`の設定を使用 |
| Output Directory | 変更不要（Next.jsの既定値） |

このアプリは`@reserveflow/shared`を参照するpnpm monorepoです。`apps/web/vercel.json`は依存関係のインストールとビルドをリポジトリルートから実行します。VercelのRoot Directory設定では、Root Directory外のソースファイルを含める設定を有効にしてください。

VercelのPreview・Production環境に、公開してよい値だけを設定します。`NEXT_PUBLIC_`変数はブラウザへ含まれるため、秘密情報を設定してはいけません。

```dotenv
NEXT_PUBLIC_COSTON2_RPC_URL=https://coston2-api.flare.network/ext/C/rpc
NEXT_PUBLIC_ATTESTATION_WORKER_URL=https://attestation.example.com
NEXT_PUBLIC_RESERVE_FLOW_CORE_ADDRESS=0x...
NEXT_PUBLIC_FDC_HUB_ADDRESS=0x...
NEXT_PUBLIC_CREDIT_VAULT_ADDRESS=0x...
NEXT_PUBLIC_RFUSD_ADDRESS=0x...
```

WorkerのHTTPS URLと公開コントラクトアドレスを設定してPreviewとProductionを再ビルドします。`FDC_VERIFIER_API_KEY_TESTNET`、XRPL seed、秘密鍵はVercelのフロントエンドProjectへ設定しません。

CLIでのPreview確認は、リポジトリルートからVercel Projectをリンクして実行します。

```sh
pnpm dlx vercel link --repo
pnpm dlx vercel
```

本番へのPromoteは、PreviewでCoston2のみへの接続、Test rfUSD onlyの表示、Worker URLがHTTPS APIを指すこと、CORS OriginがPreview/Production URLと一致することを確認してから行ってください。

## デモ運用手順

### 1. Coston2の読み取り接続を確認する

これは送金しない読み取り専用チェックです。FDC関連アドレスをFlare Contract Registryから解決します。アドレスをソースコードへ固定しないでください。

```sh
set -a; source .env; set +a
export COSTON2_FDC_SMOKE_CONFIRM='READ_COSTON2_FDC'
pnpm --filter @reserveflow/attestation-worker smoke:coston2-fdc
```

### 2. コントラクトをCoston2へデプロイする

この操作はC2FLRを使うブロードキャストです。デプロイ前にCoston2 RPC、デプロイヤー、借入者アドレスを確認してください。

```sh
set -a; source .env; set +a
pnpm --filter @reserveflow/contracts deploy:coston2
```

出力された`packages/contracts/deployments/coston2.local.json`から`ReserveFlowCore`などのアドレスを取得します。このローカル出力ファイルは公開識別子のみを持つ想定ですが、環境別ファイルとしてGit管理しません。準備金アカウントの登録・承認には、出力された実際の`ReserveFlowCore`アドレスを使ってください。古いサンプルアドレスを再利用してはいけません。

### 3. XRPL Testnetの支払いを作成する（任意）

既存の`tesSUCCESS`トランザクションを使う場合はこの手順を省略できます。送金する場合は明示的な確認値が必要です。

```sh
set -a; source .env; set +a
export XRPL_TESTNET_CONFIRM='SEND_TEST_XRP'
pnpm --filter @reserveflow/attestation-worker send:xrpl-test-payment
```

結果の`transactionHash`、送金元・送金先、額、方向を記録します。`temREDUNDANT`は残高変化のない冗長な送金であり、有効な新規支払いproofにはなりません。別の有効なTestnet支払いを使い、同じトランザクションを再提出しないでください。

### 4. FDC `XRPPayment` proofを申請・提出する

proofリクエストはC2FLR手数料とガスを消費しますが、署名はWorkerではなく接続済み借入者ウォレットが行います。トランザクションがXRPL Testnetで`tesSUCCESS`になり、少なくとも3 ledger経過してから実行してください。

```sh
set -a; source .env; set +a
pnpm --filter @reserveflow/attestation-worker serve:attestations
```

WebでXRPL transaction hashを入力して「ウォレットでFDC申請」を押し、FDCのラウンド確定後に「証明を確認・Coreへ提出」を押します。成功時はFdcHub request hash、Core proof transaction hash、`VERIFIED`状態を確認します。FDCのラウンド確定は通常90〜180秒程度です。

### 5. 借入可能かを確認する

proof提出トランザクションの確認後、Web画面またはコントラクト読取りで`HEALTHY`を確認してからテスト用rfUSDを借ります。次のいずれかなら新規借入を止めます。

- FTSO価格が60秒を超えてstale
- 準備金proofが900秒を超えてstale
- リスク状態が`HEALTHY`以外、または借入停止中
- 借入者・準備金アカウントが未承認、または担保・流動性が不足

## 失敗時の復旧

| 症状 | 確認・復旧 |
| --- | --- |
| `HTTP 401 Unauthorized` | `FDC_VERIFIER_API_KEY_TESTNET`がTestnet用であることを確認します。キーを出力せず、環境変数だけを更新して再試行します。 |
| DA Layerの`HTTP 400`またはproof未取得 | リクエスト直後は投票ラウンドが未確定です。既定の待機内では再送しません。timeout後は出力したrequest hashを`FDC_XRP_PAYMENT_EXISTING_REQUEST_TRANSACTION_HASH`に設定して再開します。 |
| `fetch failed` | Coston2 RPC、DA Layer URL、ネットワーク接続を確認し、read-only smokeを再実行します。 |
| `temREDUNDANT` | 残高が変わらない送金です。新しい有効なXRPL Testnet支払いを作成するか、既存の`tesSUCCESS`ハッシュを使います。 |
| `InvalidFdcProof` | fixtureや未確定proofを送っていないか確認します。DA Layerから得たproofだけを提出し、オンチェーン検証失敗時は借入を試みません。 |
| `STALE_PRICE` / `STALE_RESERVE` / `BORROWING_PAUSED` | 新規借入を行いません。freshな価格・proofを待つか、管理者が停止理由を解消します。返済フローは維持されます。 |

再開時に同じFDC requestの料金を二重に払わないよう、まず`FDC_XRP_PAYMENT_EXISTING_REQUEST_TRANSACTION_HASH`を使って既存リクエストを検証します。新しいFDC requestを作るのは、元のrequestが無効であると確認できた場合だけです。

詳細は[XRPL payment proof申請ガイド](docs/xrp-payment-proof-request.md)と[Coston2検証ガイド](docs/contract-verification-guide.md)を参照してください。

## 品質ゲート

変更ごとに対象テストを先に実行し、統合前に次を通します。

```sh
pnpm test
pnpm typecheck
pnpm check
pnpm --filter @reserveflow/contracts test
pnpm --filter @reserveflow/contracts typecheck
pnpm --filter @reserveflow/attestation-worker test
pnpm --filter @reserveflow/web test
pnpm --filter @reserveflow/web test:e2e:fixtures
pnpm --filter @reserveflow/web build
```

自動整形が必要な場合だけ、変更内容を確認したうえで実行します。

```sh
pnpm format
```

ネットワーク操作・デプロイ・XRPL送金・FDC fee支払いは品質ゲートではありません。いずれも上記の明示確認値を設定した場合だけ実行してください。
