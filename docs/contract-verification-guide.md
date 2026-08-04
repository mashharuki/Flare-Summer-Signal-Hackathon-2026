# ReserveFlow Credit コントラクト動作確認手順

## 目的と安全境界

この手順書は、ReserveFlow Credit のCoston2向けスマートコントラクトを検証するためのものです。rfUSDはテスト専用トークンであり、実資産・法定通貨・本番融資には使用しません。

検証は次の二段階に分けます。

1. **ローカル検証**: Foundryの決定的なテストで、台帳・価格・与信・返済・デプロイ順を確認する。
2. **Coston2スモークテスト**: テストネットへデプロイし、Registry解決、権限、初期rfUSD供給を読み取りで確認する。

`packages/contracts/fixtures/xrpl-payments.demo.json` はFDC証明そのものではありません。これはXRPL Testnet用のデモ入力であり、取得したMerkle proofを必ずオンチェーンで検証してから使います。

## 事前準備

- Node.js と pnpm 10.33.0
- Foundry（`forge`、`cast`）
- Coston2スモークテストを行う場合のみ、C2FLRを保有するデプロイ用ウォレット
- Coston2上で承認する借入者のEVMアドレス

依存関係をまだ導入していない場合は、リポジトリ直下で実行します。

```sh
pnpm install
```

## 1. ローカルでコントラクトを検証する

まず、外部RPCや秘密鍵を使わないFoundryテストを実行します。

```sh
pnpm --filter @reserveflow/contracts test
```

ネットワーク不要で実行する場合は、次を使います。

```sh
NO_PROXY='*' pnpm --filter @reserveflow/contracts test --offline
```

macOS環境でFoundryがシステムproxyの初期化時に停止する場合も、上記の`NO_PROXY='*'`を付けてください。

### 重点テスト

```sh
NO_PROXY='*' pnpm --filter @reserveflow/contracts test --match-contract ReserveFlowCoreTest --offline
NO_PROXY='*' pnpm --filter @reserveflow/contracts test --match-contract RiskEngineTest --offline
NO_PROXY='*' pnpm --filter @reserveflow/contracts test --match-contract CreditVaultTest --offline
NO_PROXY='*' pnpm --filter @reserveflow/contracts test --match-contract DeploymentPlanTest --offline
```

| テスト | 確認する内容 |
| --- | --- |
| `ReserveFlowCoreTest` | FDC Registry解決、借入者承認、XRPL入出金、proof replay、順序逆転、凍結 |
| `RiskEngineTest` | FTSO Registry解決、価格・準備金TTL、haircut、advance rate、health、Risk Admin設定 |
| `CreditVaultTest` | Healthy時の借入、枠超過・stale・停止時の拒否、allowance付き返済、原子性 |
| `DeploymentPlanTest` | Core → RiskEngine → Vault → rfUSDの順序、初期供給、mint権限撤回、借入者承認 |

すべて成功したことを確認してからCoston2へ進んでください。

## 2. Coston2デプロイの準備

`.env.example`をコピーし、ローカル専用の`.env`を作成します。

```sh
cp .env.example .env
```

以下の値を設定します。`DEPLOYER_PRIVATE_KEY`は絶対にコミット、共有、ログ出力しないでください。

```dotenv
COSTON2_RPC_URL=https://coston2-api.flare.network/ext/C/rpc
DEPLOYER_PRIVATE_KEY=0x...
DEMO_BORROWER_ADDRESS=0x...
DEPLOYMENT_OUTPUT_PATH=deployments/coston2.local.json
```

デプロイ用アカウントは、Coston2 Faucetからテスト用C2FLRを受け取ります。送信前に接続先と署名者を確認してください。

```sh
source .env
cast chain-id --rpc-url "$COSTON2_RPC_URL"
cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY"
```

前者は`114`を返し、後者のアドレスがRisk Adminになります。

## 3. Coston2へデプロイする

スクリプトだけを事前コンパイルできます。

```sh
NO_PROXY='*' pnpm --filter @reserveflow/contracts exec forge build script/DeployCoston2.s.sol --offline
```

実際のブロードキャストは、環境変数を設定したローカル端末でのみ実行します。`.env`の値を現在のshellへ読み込んでから、追加引数なしで実行してください。

```sh
set -a
source .env
set +a
pnpm --filter @reserveflow/contracts deploy:coston2
```

`deploy:coston2`は`--rpc-url "$COSTON2_RPC_URL" --broadcast`をすでに含んでいます。`--`、`--rpc-url`、`--broadcast`をこのコマンドへ追加しないでください。

この処理は次の順に実行されます。

1. Coston2 Contract Registryから`FdcVerification`を解決して`ReserveFlowCore`をデプロイする。
2. Registryから`FtsoV2`を解決する`RiskEngine`をデプロイする。
3. `CreditVault`をデプロイする。
4. Vault宛てに1,000,000 rfUSDを初期供給する`MockUSD`をデプロイし、mint/admin権限を撤回する。
5. VaultへrfUSDを一度だけ設定し、借入者を承認し、初期risk configを明示的に設定する。

成功すると、`packages/contracts/deployments/coston2.local.json`へ公開可能な設定だけが出力されます。秘密鍵、RPC認証情報、FDC API keyは出力されません。このファイルはGit管理対象外です。Webとworkerには、このファイルの契約アドレス・chain ID・source IDだけを渡してください。

## 4. デプロイ後の読み取り確認

出力ファイルから値を読み込みます。

```sh
CONFIG=packages/contracts/deployments/coston2.local.json
CORE=$(jq -r .reserveFlowCore "$CONFIG")
RISK=$(jq -r .riskEngine "$CONFIG")
VAULT=$(jq -r .creditVault "$CONFIG")
TOKEN=$(jq -r .rfUsd "$CONFIG")
BORROWER=$(jq -r .approvedBorrower "$CONFIG")
```

以下が期待どおりか確認します。

```sh
cast call "$CORE" "fdcVerification()(address)" --rpc-url "$COSTON2_RPC_URL"
cast call "$RISK" "riskConfigVersion()(uint64)" --rpc-url "$COSTON2_RPC_URL"
cast call "$CORE" "approvedBorrowers(address)(bool)" "$BORROWER" --rpc-url "$COSTON2_RPC_URL"
cast call "$TOKEN" "balanceOf(address)(uint256)" "$VAULT" --rpc-url "$COSTON2_RPC_URL"
```

- `fdcVerification`はゼロアドレス以外であること。
- `riskConfigVersion`は`2`であること（constructorの既定値に加え、初期設定を明示適用するため）。
- `approvedBorrowers`は`true`であること。
- VaultのrfUSD残高は`1000000000000000000000000`（1,000,000 × 10^18）であること。

## 5. 準備金・借入フローの確認範囲

実際の借入には、freshなFTSO価格と、`ReserveFlowCore`で検証済みのXRPL Payment proofが必要です。デモfixtureをそのまま`submitXrpPaymentProof`へ送信してはいけません。

実証明では、次の順を守ります。

1. 承認済み借入者がXRPL準備金アカウントを登録し、Risk Adminが承認する。
2. `testXRP`のXRPPayment attestationをFDCへ申請する。
3. ラウンド確定後にDA LayerからMerkle proofを取得する。
4. 借入者がproofを`submitXrpPaymentProof`へ提出する。
5. 準備金・価格がfreshで`HEALTHY`になったことを読み取り、借入を実行する。

CoordinatorによるVerifier申請、ラウンド待機、DA Layer取得の自動化はタスク3で実装予定です。現時点ではローカルfixtureとFoundryテストで契約境界を確認し、実ネットワークではFDC公式フローに従って型付きproofを準備してください。

## トラブルシューティング

- **`UnsupportedChain(…)`**: RPCまたはローカルチェーンIDが114ではありません。Coston2へ切り替えてください。
- **Registry解決で失敗**: Coston2 RPCに接続できない、または別ネットワークを参照しています。固定FDC/FTSOアドレスを設定して回避しないでください。
- **`BORROWING_PAUSED` / `STALE_PRICE` / `STALE_RESERVE`**: 新規借入は停止されます。返済は引き続き可能です。
- **`InvalidFdcProof`**: demo fixtureや未確定の応答を使っている可能性があります。DA Layerから取得した最新のproofを使い、オンチェーン検証を通してください。
- **Vault残高不足**: 借入は原子的に失敗します。rfUSDを追加発行しないでください。MVPでは初期供給後にmint権限を撤回します。

## それ以降

- XRPL testnetのアカウントを作成

```bash
cast wallet address --private-key "$BORROWER_PRIVATE_KEY"

CORE=0x76E44862C78b13Ae4E36759aC30965923cdAF87C
HASH=0x23cd51d0ffda904dd4d7a6a93aa286138308a4b6ca30626c73dca8b839671669

cast send "$CORE" "registerReserveAccount(bytes32)" "$HASH" \
  --private-key "$BORROWER_PRIVATE_KEY" \
  --rpc-url "$COSTON2_RPC_URL"

CORE=0x76E44862C78b13Ae4E36759aC30965923cdAF87C
ACCOUNT_ID=0x0069c37c0dc5c651b4f47b311bc44cf9fe9dd2d0d673c8f146b9bdf6ac19395a

cast send "$CORE" "approveReserveAccount(bytes32)" "$ACCOUNT_ID" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --rpc-url "$COSTON2_RPC_URL"

cast call "$CORE" \
  "getReserveAccount(bytes32)((address,bytes32,bytes32,uint256,uint64,uint64,uint8))" \
  "$ACCOUNT_ID" \
  --rpc-url "$COSTON2_RPC_URL"
```