# 提出物 / README チェックリスト

DoraHacksやETHGlobal系のFlare審査で繰り返し評価要件になっている項目。埋まっていない行は
提出前に埋めるか、意図的に「未対応」と明記する。

## 必須項目

- [ ] 動作するアプリへのlive URL
- [ ] Open sourceなリポジトリへのリンク
- [ ] デプロイ済みcontract addressをREADMEに明記（Coston2 chain ID 114 等ネットワーク名も併記）
- [ ] Flareプロトコル（FTSO/FDC/FAssets/Smart Accounts/TEE）の実質的な使用箇所を明示
- [ ] セットアップ手順（clone → install → env → run）
- [ ] テスト実行コマンド（`bun test` 等）
- [ ] アーキテクチャ図または簡潔な説明

## README推奨セクション構成

```markdown
# プロジェクト名

## 解決する問題
## なぜFlareが必要か（使用しているFlare機能と因果関係）
## デモ / Live URL
## アーキテクチャ
## デプロイ済みコントラクト
| コントラクト | ネットワーク | アドレス |
## セットアップ
## テスト
## 既知の制約・mainnet化までの残作業
## チーム
```

## 正直さのチェック（審査員の信頼を失わないために）

- [ ] mainnet未提供の機能（例: Web2JsonはCoston2/Costonのみ）を「本番機能」と誤解させていないか
- [ ] mockした部分（外部API、決済等)がある場合、どこがmockかを明示しているか
- [ ] 「監査済み」等の表現を、実際に監査していないのに使っていないか

## 提出直前の最終確認

- [ ] happy pathを審査員が自分で1回再現できるか（wallet接続〜最終アクションまで）
- [ ] 失敗ケースのデモまたは説明が1つ以上あるか
- [ ] ピッチが3分に収まるか（[[pitch-outline-template]]参照）
