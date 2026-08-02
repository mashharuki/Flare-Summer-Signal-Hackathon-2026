# Research & Design Decisions

## Summary

- **Feature**: `reserveflow-credit`
- **Discovery Scope**: 複雑な新規統合（フルディスカバリー）
- **Key Findings**:
  - FDCは非同期プロトコルであり、申請、ラウンド確定、DA Layerからの証明取得、コントラクト検証を分離する必要がある。
  - XRPL TestnetのMVPには、送金のMemo・Destination Tag・`proofOwner`を扱える`XRPPayment`が適する。
  - Coston2では`TestFtsoV2Interface`の`getFeedByIdInWei`を用い、USD価格を18桁の固定小数点として扱える。

リポジトリには実装済みのアプリケーションはなく、pnpmの基本設定、Biome設定、およびドキュメント／UIモックのみが存在する。`design-principles.md`および`design-discovery-full.md`は未配置のため、テンプレート、Steering、`docs/memo.md`、および一次情報で補完した。

## Research Log

### FDCの証明フローと信頼境界
- **Context**: 外部XRPLの資産移動を、借入可能額へ安全に反映する必要がある。
- **Sources Consulted**: [FDC Overview](https://dev.flare.network/fdc/overview)、[FDC Getting Started](https://dev.flare.network/fdc/getting-started)、[IXRPPayment Reference](https://dev.flare.network/fdc/reference/IXRPPayment)
- **Findings**:
  - FDCは`FdcHub`への申請後、ラウンド確定（通常90〜180秒）、DA LayerからのレスポンスとMerkle証明取得、`FdcVerification`によるオンチェーン検証という段階を持つ。
  - DA Layerやオーケストレータが返すデータは信用しない。事業ロジックは検証済みの`XRPPayment`証明だけを受け入れる。
  - `XRPPayment`は`testXRP`をサポートし、送受信アドレスハッシュ、drops建て金額、最初のMemo、Destination Tag、結果状態、`proofOwner`を提供する。
- **Implications**: 証明進行状況を永続化するオフチェーン調整層と、最終検証・重複排除・台帳更新を行うオンチェーン層を分離する。外部準備金の「現在残高」全体は単一の送金証明では保証できないため、証明TTLと保守的な借入停止を必須とする。

### FTSO価格と単位
- **Context**: 検証済みXRP残高を正確かつ再現可能にUSD換算する必要がある。
- **Sources Consulted**: [FTSO Feed Reference](https://dev.flare.network/ftso/solidity-reference/FtsoV2Interface)、[Block-Latency Feeds](https://dev.flare.network/ftso/feeds)
- **Findings**:
  - `getFeedByIdInWei(bytes21)`は価格を18桁精度とタイムスタンプで返す。XRP/USDフィードが提供されている。
  - Coston2では`ContractRegistry.getTestFtsoV2()`を使用する。プロトコルコントラクトのアドレスはハードコードせずRegistryから解決する。
  - feed値・残高・負債はすべて整数の最小単位で計算し、画面表示時のみ変換する。
- **Implications**: Risk Engineは`drops`、`wad`、`basis points`を明確に区別し、`number`や浮動小数点を境界に持ち込まない。価格タイムスタンプを借入判定の入力にする。

### ネットワークと既存資産
- **Context**: ハッカソンMVPの対象ネットワークと、拡張してよい既存構成を確定する必要がある。
- **Sources Consulted**: [Flare Network Overview](https://dev.flare.network/network/overview)、[Flare Contract Registry](https://dev.flare.network/network/guides/flare-contracts-registry)、リポジトリの`package.json`、`docs/memo.md`、全Steering
- **Findings**:
  - Coston2はdApp開発用のFlare Testnetで、chain IDは114である。
  - Registryは`FtsoV2`や`FdcHub`など公式プロトコルコントラクトを動的に解決する唯一の信頼済みソースである。
  - 現状はアプリ／コントラクトのソースコードを持たないため、既存の実装境界との互換性制約はない。
- **Implications**: pnpmワークスペースに、web、attestation worker、Solidity contracts、shared SDKを追加する。MVPの外部資産はXRPL TestnetのXRPに固定する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Decision |
|---|---|---|---|---|
| 単一フロントエンド | 画面がFDCと契約呼び出しを直接管理 | 最小の初期構成 | 90〜180秒の非同期状態、再開、監査履歴が不安定 | 不採用 |
| モノリシック契約 | 登録、証明、評価、借入を1契約へ集約 | デプロイ数が少ない | 信頼境界とリスク計算が混在し、テスト・監査が難しい | 不採用 |
| ドメイン分割＋薄い調整層 | Core、Risk、Vault、Tokenを分離し、オフチェーン層は証明状態のみを扱う | 検証と与信の境界が明確、FDC失敗から再開可能 | 初期ファイル数が増える | 採用 |

## Design Decisions

### Decision: XRPL Testnetの`XRPPayment`を唯一の証明型にする
- **Context**: MVPは1資産・1外部チェーン・1証明フローに制限する。
- **Alternatives Considered**:
  1. 汎用`Payment` — XRPを扱えるがXRPL固有の相関情報が弱い。
  2. `XRPPayment` — Memo、Destination Tag、`proofOwner`まで検証可能。
- **Selected Approach**: `testXRP`の`XRPPayment`を採用し、EVM借入者を`proofOwner`に束縛する。
- **Rationale**: XRPL向けのデモで、証明と利用者の結び付けを明示できる。
- **Trade-offs**: BTCなどへの一般化は後続仕様へ移す。
- **Follow-up**: 利用するテストネットのVerifier／DA LayerエンドポイントとAPIキーを実装開始時に環境変数で構成する。

### Decision: Canonical stateはオンチェーン、進行状態はオフチェーン
- **Context**: FDCは最終証明の前に複数の待機段階を持つ。
- **Alternatives Considered**:
  1. 進行状態もすべてオンチェーンへ保存する。
  2. 進行状態はworkerの永続ストアに保存し、準備金・負債・与信はオンチェーンに限定する。
- **Selected Approach**: 後者を採用する。
- **Rationale**: 金融上の真実を検証済み契約状態に限定しつつ、再開可能なUXを提供できる。
- **Trade-offs**: workerストアは失われても再作成可能だが、FDC申請メタデータの再収集が必要になる。
- **Follow-up**: `AttestationRecord`をrequest bytes hashとround IDで一意化する。

### Decision: 借入時にリスクを導出し、強制清算は実装しない
- **Context**: 外部資産をFlare上で直接差し押さえられない。
- **Alternatives Considered**:
  1. 価格更新ごとにポジション状態を永続的に書き換える。
  2. 借入・同期・返済時に現在の準備金と価格からスナップショットを導出する。
- **Selected Approach**: 後者を採用し、危険状態では新規借入を停止し、返済は許可する。
- **Rationale**: 常時実行者を必要とせず、古いデータでの借入を防げる。
- **Trade-offs**: UIの表示は読取時点のスナップショットであり、イベント駆動の自動清算は行わない。
- **Follow-up**: プロダクション化では監視者、カストディ、またはsource-chain Vaultによる担保執行を別仕様で評価する。

### Decision: デモ値を固定し、FDC手数料とrfUSD返済を明示的に扱う
- **Context**: 実装開始前のレビューで、リスク閾値、FDC request fee、rfUSD allowanceが未確定であることが判明した。
- **Alternatives Considered**:
  1. 実装時にリスク値・手数料・返済導線を個別に決める。
  2. MVPの初期設定・fee取得・approvalフローを設計で固定する。
- **Selected Approach**: Haircut 30%、Advance Rate 50%、Price TTL 60秒、Reserve TTL 15分、Warning 120%、Margin Call 100%を初期値とする。FDC feeは準備済みrequest bytesに対して動的に取得し、rfUSDはapproval後の`transferFrom`で返済する。
- **Rationale**: デモの数値・状態遷移を再現可能にし、申請と返済が実際に完結する。
- **Trade-offs**: 数値は本番リスクモデルではなく、MVPの保守的な既定値である。
- **Follow-up**: deploy scriptで初期configと`1,000,000 rfUSD`のVault供給後にmint権限を撤回することをテストする。

## Risks & Mitigations

- 単一のPayment証明が現在残高全体を保証しない — 専用準備金アドレス、借入者・アドレスの承認バインディング、短い証明TTL、保守的なHaircut、借入停止で緩和する。
- FDCのラウンド待機またはDA Layer取得失敗 — 再試行可能な状態機械、期限、失敗理由、利用者による最終提出を提供する。
- 価格・単位の誤り — `drops`／`wad`／BPSの型を分け、全計算を整数演算に限定し、境界・オーバーフローのテストを行う。
- 証明の再利用・別利用者への横取り — `proofOwner`、account ID、証明ID、外部ブロック単調性を検証する。
- 管理者権限の濫用 — MVPではRisk Adminの権限を限定し、すべての設定変更・凍結をイベント化する。実運用の権限分離・マルチシグは後続範囲とする。

## References

- [FDC Overview](https://dev.flare.network/fdc/overview) — FDCのMerkle証明とDA Layerの一般フロー。
- [FDC Getting Started](https://dev.flare.network/fdc/getting-started) — 申請、ラウンド確定、証明取得、オンチェーン検証の手順。
- [IXRPPayment Reference](https://dev.flare.network/fdc/reference/IXRPPayment) — XRPL Payment証明の型、`testXRP`、`proofOwner`。
- [FTSO Feed Reference](https://dev.flare.network/ftso/solidity-reference/FtsoV2Interface) — `getFeedByIdInWei`の返却値とCoston2テストインターフェース。
- [Block-Latency Feeds](https://dev.flare.network/ftso/feeds) — XRP/USDフィードとfeed IDの扱い。
- [Flare Network Overview](https://dev.flare.network/network/overview) — Coston2の用途とchain ID。
- [Flare Contract Registry](https://dev.flare.network/network/guides/flare-contracts-registry) — プロトコルコントラクトの動的解決方針。
