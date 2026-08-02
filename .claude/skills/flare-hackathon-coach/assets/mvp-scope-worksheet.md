# MVPスコープ・ワークシート

このワークシートを埋めて、チームの「唯一のパス」を1枚で確定させる。空欄が残っている項目は
まだスコープが広すぎるサイン。

## 唯一の組み合わせ

| 項目 | 選択 | 理由 |
|---|---|---|
| 対応資産（1つ） | 例: XRP | |
| 外部チェーン（1つ） | 例: XRP Ledger Testnet | |
| Attestation type（1つ） | 例: FDC Payment | |
| 決済アクション（1つ） | 例: FXRP Vault deposit | |
| ネットワーク | 例: Coston2 (Chain ID 114) | 本番前提ならメインネット提供状況を確認 |

## Flare固有性チェック

- [ ] 使用するFlare機能は2つ以上か（FTSO/FDC/FAssets/Smart Accounts/TEE）
- [ ] そのうち1つでも欠けたら、この製品の価値は崩れるか（YESでなければ再設計）
- [ ] Oracle/attestationは「表示」でなく実際の資産移動・与信・清算等のアクションに接続されているか

## Happy Pathの一文

> ユーザーが〔    〕をすると、Flareが〔    〕を検証し、その結果に基づいて〔    〕が実行される。

## 失敗・エッジケース（最低1つは実演する）

- [ ] stale price / stale attestation時の挙動
- [ ] duplicate proof / replay時の挙動
- [ ] timeout時の再試行・refund・cancel経路
- [ ] wallet reject / insufficient gas / wrong network時のUI

## やらないことリスト（スコープを削った証拠として残す）

- 例: BTC/DOGE対応は今回やらない（XRPのみ）
- 例: 自動liquidationは実装せず、risk-off推奨表示に留める
- 例: mainnet展開はせず、Coston2のみで完結させる
