# 過去のFlareハッカソン受賞作 & 成功・失敗パターン

## ケーススタディ

| プロジェクト | イベント・結果 | アイデアと実装 | 再利用できる教訓 |
|---|---|---|---|
| **Bridge.flare** | ETH Oxford 2024、Flare賞 | Ethereum–Flare双方向bridge。外部イベントをFDC、価格・gasをFTSOで処理 | クロスチェーン処理に価格・手数料・証明を統合する |
| **XTF Protocol** | ETH Oxford 2024、Innovative dApp 1位 | 複数チェーン資産のETF。State ConnectorとFTSOでNAV計算 | 「指数・NAV」はFTSOと相性が良い |
| **FireLink Bridge** | ETH Oxford 2024、2位 | attestation requestとproofを売買・仲介するmarketplace | エンドユーザー向けでなくインフラ製品も有力 |
| **Block Roulette** | ETH Oxford 2024、3位 | Secure Randomを使うroulette | ランダム機能は短時間デモに強い |
| **Sepia** | Encode London 2024、1位 | FHEとFDCを組み合わせ秘密データを検証 | 暗号技術はユーザー価値へ翻訳して見せる |
| **GuardFi** | Encode London 2024、3位 | クロスチェーンexploitをFDCで確認し保険金を支払う | FDCは保険・補償と非常に相性が良い |
| **2DeFi** | Flare × Google Cloud 2025、AI×DeFi 1位等 | 画面情報をAIでrisk profile化し、Flare DeFi戦略を作成 | AIは会話で終わらせずDeFiアクションへ接続する |
| **RampNet** | ETHGlobal Cannes、Flare Main Track 1位 | Wise支払いをFDCで証明、FTSOで換算、FXRP/LayerZeroで配送 | Fiat→証明→価格→資産配送という完全な製品フロー。最強の例 |
| **kleos** | ETHGlobal New York 2025、Flare 3位 | FTSO/FDC Web2Json/Secure Random/AIを切替可能な予測市場resolver | Oracle選択自体をプロトコル設計にする |
| **MultisigPE** | ETHGlobal Cannes 2026、Smart Account賞 | TEEで秘密トランザクション評価、FTSOでUSD換算、riskからmultisig閾値を動的決定 | 高度な技術でも具体的な業務課題に落とすと伝わる |
| **VeraFi** | ETHGlobal Cannes 2026 | TEE内Monte Carlo、FTSO spot/履歴、Secure RandomでFXRP option quote | 数理モデルの入力を全て検証可能にする |

## 勝ちパターンの共通点

1. FTSOまたはFDCを**ビジネスロジックの中核**に置く（価格表示や飾りではない）。
2. 外部支払い・価格・保険事故・財務リスクなど、**Oracleがなければ成立しない問題**を選ぶ。
3. 複数技術（FAssets, LayerZero, TEEなど）を組み合わせ、**入力から決済までの完結したデモ**を作る。
4. 審査員が**一文で理解できる製品**にまとめる（技術の羅列にしない）。

最強の作品は「機能の数が多い」のではなく、**各機能が不可欠な因果関係**を持つ。RampNetでは
FDCが法定通貨支払いを証明し、FTSOが受取量を決め、FAssets/LayerZeroが資産を届ける——
どの機能を一つ外しても製品価値が崩れる。**この「一つでも抜くと壊れるか」というテストが
アイデア選定の最重要チェックである。**

## 失敗しやすいパターン（アンチパターン）

| 失敗パターン | なぜ弱いか | 改善策 |
|---|---|---|
| FTSOを価格表示だけに使用 | Chainlink等でも代替でき、Flare固有性がない | 清算・保険金・limit・quote等の実アクションへ接続する |
| FDCをmockしたまま | 主要な技術リスクを回避しており完成度が伝わらない | 少なくとも一種類は実際のCoston2 roundで通す |
| 対応チェーン・機能を広げすぎる | bridge、AI、DeFi、NFTが全て未完成になる | 一つのsource chain、一つのasset、一つのactionに絞る |
| バックエンドを安易に「Oracle」と呼ぶ | 中央集権的入力をFDCで包装しただけになる | データ出所・schema・proof・failure pathを明示する |
| 成功時しかデモしない | Oracle障害・stale値・duplicate proofに弱く見える | pause・retry・replay rejectionを一つ実演する |
| UIがblock explorer依存 | 審査員が価値を理解しにくい | 一画面で状態遷移(state machine)を見せる |
| mainnet前機能を本番機能と説明 | 技術的信頼を失う | Coston2限定・mock範囲・将来機能であることを明示する |
| コントラクトアドレス・READMEが不足 | 再現性・完成度が低く見える | live URL・repo・address・test commandを必ず用意する |

mockを使うこと自体は問題ではない。**mockの境界を隠さず明示し、Flare固有部分（FTSO/FDC呼び出し等）
だけは実際に動かす**のが、アイデア検証と本番準備度評価の両立になる。
