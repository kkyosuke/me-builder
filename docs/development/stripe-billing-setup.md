# Stripe課金環境セットアップ

## 1. 目的と所有範囲

この文書は、Local・PreviewのStripe sandboxとProductionのlive modeへ、商品catalog、Customer Portal、Webhook endpointを再現する手順と設定境界を定義します。

### 所有する概念

- Stripe Product / Price、Portal、Webhook endpointの宣言的セットアップ
- 環境ごとに差し替える設定、Secret、生成された対応表の配布
- Stripe SDKとAPI versionの更新確認手順

### 所有しない概念

- 価格とプラン内容の決定
- Stripeと共有D1の状態変換
- 障害時の復旧判断

価格は[サブスクリプション・料金プラン設計](../product/subscription-plan-design.md)、状態変換は[課金・Plan紐付け実装設計](../architecture/billing-implementation-design.md)を正とします。

## 2. 設定境界

```text
apps/api/
├── config/
│   └── billing-catalog.json       # 既定の宣言。別ファイルへ差し替え可能
└── scripts/
    └── setup-billing.ts           # 冪等なStripe設定
```

| 設定 | 用途 | 秘密 |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe API接続。sandboxは`sk_test_` / `rk_test_`、Productionは`sk_live_` / `rk_live_`を強制 | はい |
| `BASE_URL` | Webhook endpointのAPI origin | いいえ |
| `WEB_ORIGIN` | Portalから戻るWeb UIのorigin | いいえ |
| `BILLING_CATALOG_FILE` | 既定catalogを差し替えるJSON path | いいえ |
| `BILLING_SETUP_OUTPUT` | 生成したruntime設定と新規Webhook Secretの書込先 | 内容は秘密 |
| `BILLING_LOOKUP_KEY_MAP` | CheckoutでPlanと請求間隔を許可済みlookup keyへ変換 | いいえ |
| `BILLING_PRICE_PLAN_MAP` | Webhook projectionでPrice IDをPlanへ変換 | いいえ |
| `BILLING_PORTAL_CONFIGURATION_ID` | 環境専用のPortal configurationをSessionへ固定 | いいえ |
| `STRIPE_WEBHOOK_SECRET` | raw bodyの署名検証 | はい |

`BILLING_CATALOG_FILE`を省略すると、リポジトリ管理の`apps/api/config/billing-catalog.json`を使います。差し替えファイルも同じschemaを満たし、Lite・Full・ファミリーパックそれぞれに月額・年額を1件ずつ持つ必要があります。価格を変えるときは料金プランのSSoTを先に変更します。

## 3. 実行

空のsandboxを作成し、次のように実行します。

```sh
umask 077
export STRIPE_SECRET_KEY='sk_test_...'
export BASE_URL='https://api.stg.example.com'
export WEB_ORIGIN='https://stg.example.com'
export BILLING_SETUP_OUTPUT="$(pwd)/billing-setup-output.json"
task billing:setup:preview
```

Localは`task billing:setup:local`、Productionは`task billing:setup:production`を使います。スクリプトは次を収束させます。

1. metadataのcatalog keyでProductを検索し、無ければ作成する
2. `lookup_key`でPriceを検索し、金額・通貨・期間が異なる場合は新Priceへlookup keyを移す
3. 支払方法更新、請求履歴、期間末解約、価格変更だけを許可したPortal configurationを作成・更新する
4. 許可済みeventだけを配信するWebhook endpointを作成・更新する
5. Price ID対応表と、新規作成時だけ返るWebhook Secretを権限`0600`の出力ファイルへ書く

出力ファイルの内容を標準出力、PR、issueへ貼り付けません。`BILLING_PRICE_PLAN_MAP`はAPIとWorker、`BILLING_LOOKUP_KEY_MAP`と`BILLING_PORTAL_CONFIGURATION_ID`はAPI、`STRIPE_WEBHOOK_SECRET`はAPIのGitHub Environmentへ配布し、確認後に出力ファイルを安全に削除します。既存Webhook endpointのSecretはStripeから再取得できないため、出力に含まれない場合は既存のGitHub Secretを維持します。

## 4. 更新と検証

Stripe SDKは`packages/lib/package.json`と`apps/api/package.json`で同じversion範囲へ固定し、API versionは`STRIPE_API_VERSION`へ固定します。更新PRではStripeの公式changelog、Checkout・Portal・Webhook・Test ClockのAPI referenceを確認し、次を実行します。

```sh
task lint
task typecheck
task test
```
