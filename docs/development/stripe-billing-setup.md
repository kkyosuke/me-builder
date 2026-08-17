# Stripe課金環境の同期運用

## 1. 目的と所有範囲

この文書は、Stripeの商品catalog、Webhook、Customer Portalと、アプリへ渡すStripe設定をDashboard操作なしでPreview・Productionへ再現する手順を定義します。

### 所有する概念

- Stripe Product / Priceの識別規則と同期コマンド
- Webhook / Customer Portalの同期範囲
- Stripe secretとPrice IDからPlanへの対応をCloudflareへ配布する手順
- 再実行、価格変更、失敗時の安全境界

### 所有しない概念

- Planの価格、機能、上限、トライアル条件
- Stripe契約状態からAccountへPlanを付与する実装
- Checkout、Portalから戻った後の画面体験
- 本番課金を開始できるかの法務・税務・提供機能判断

価格とPlanの内容は[サブスクリプション・料金プラン設計](../product/subscription-plan-design.md)、Accountとの紐付けは[課金・Plan紐付け実装設計](../architecture/billing-implementation-design.md)、障害対応は[課金監視・復旧Runbook](billing-operations-runbook.md)、残るリリースゲートは[サブスクリプション実装残タスク](subscription-remaining-tasks.md)を正とします。

## 2. 同期する資源

`scripts/setup-stripe-billing.ts`は次の資源だけを管理します。

| 資源 | 識別方法 | 同期内容 |
| --- | --- | --- |
| Product | 固定Product IDと`managed_by` metadata | Plan変更を期間末予約できる共通の有料プランProduct |
| Price | 固定`lookup_key`と`managed_by` metadata | 各Productの月額・年額、JPY、税込 |
| Webhook endpoint | URLまたは`managed_by` metadata | 課金projectionが受け付けるeventだけ |
| Customer Portal configuration | `managed_by` metadata | 支払方法、請求履歴、プラン変更、期間末解約・再開 |
| Cloudflare secret | Worker名と環境 | Stripe key、Webhook secret、Price→Plan map |

Priceの`lookup_key`は次の形式で固定します。

```text
me_builder_<lite|full|family>_<monthly|yearly>
```

金額はこの文書へ重複して持たず、料金SSoTと`STRIPE_BILLING_CATALOG`を同じ変更で更新します。Stripeが期間末downgradeを同一Product内のPrice間だけに制限するため、Lite、Full、ファミリーパックの6 Priceは共通Productへ所属させ、Price metadataからPlanへ変換します。旧Plan別ProductのPrice IDは既存契約がなくなるまで`BILLING_PRICE_PLAN_MAP`へ残します。Customer Portalは現在の6 Priceだけを変更先に許可し、upgradeは`always_invoice`で日割り差額を即時請求します。金額減少と年額から月額への短縮は`decreasing_item_amount` / `shortening_interval`条件で期間末へ予約し、trial中の変更は`continue_trial`で残期間を維持します。同一または上位Planの月額から年額への変更は、変更日を新しい年額期間の開始日にする`billing_cycle_anchor=now`専用設定を使います。この専用設定には`decreasing_item_amount`を含む期間末予約条件を設定せず、年額の月換算額が下がる場合も即時変更を妨げないようにします。それ以外は現在の請求期間を維持する標準設定を使い、アプリで選んだ変更先をPortalの確定画面へdeep linkします。支払方法・解約用の管理Portalではプラン変更を無効にし、この請求ルールを迂回できないようにします。

## 3. 実行前提

### 3.1 共通

- Stripe secret keyを環境変数`STRIPE_SECRET_KEY`へ設定する
- Cloudflareへ同期する場合は、Wranglerが利用できる認証情報を設定する
- 対象のAPI WorkerとQueue consumer Workerを先にデプロイしておく
- secretをshell history、コマンド引数、ログ、Gitへ保存しない

Previewは`sk_test_...`だけを受け付け、Productionは`sk_live_...`だけを受け付けます。Productionは誤操作防止のため`CONFIRM_STRIPE_LIVE=production`も要求します。

### 3.2 GitHub Actionsからの実行

通常の同期は手元へsecretを取得せず、手動workflow `Setup / Stripe Billing` から実行します。`stripe-dev` / `stripe-prd` EnvironmentのRequired reviewersによる承認後に、同期jobが`dev` / `prd` Environmentのsecretへアクセスします。承認をStripe専用Environmentへ分離することで、同じ`dev` / `prd`を使う通常のCDは停止させません。

GitHub Environmentには次を設定します。

| Environment | Secret / Variable | 値 |
| --- | --- | --- |
| `dev` | Secret `STRIPE_SECRET_KEY` | Stripe test modeのsecret key |
| `prd` | Secret `STRIPE_SECRET_KEY` | Stripe live modeのsecret key |
| `dev` / `prd` | Secret `CLOUDFLARE_DEPLOY_API_TOKEN` | Wranglerで対象Workerのsecretを更新できるtoken |
| `dev` / `prd` | Variable `CLOUDFLARE_ACCOUNT_ID` | 対象のCloudflare Account ID |

`stripe-dev` / `stripe-prd`は承認専用であり、SecretやVariableは登録しません。Required reviewerを設定し、`stripe-prd`のDeployment branchesは`main`だけを許可します。

Actions画面では対象Environmentと確認文字列を指定します。CLIから実行する場合は、workflowがdefault branchへマージされた後に次を使います。

```bash
gh workflow run setup-stripe-billing.yml --ref main \
  -f environment=dev \
  -f confirmation=sync-dev
```

Productionは`main`以外から実行できず、`stripe-prd` Environmentの承認と`sync-prd`の確認文字列を要求します。

```bash
gh workflow run setup-stripe-billing.yml --ref main \
  -f environment=prd \
  -f confirmation=sync-prd
```

`stripe-dev`は検証ブランチからも実行でき、`stripe-prd`はDeployment branchesで`main`だけを許可します。workflowの実行中断でStripeとCloudflareの反映点がずれることを避けるため、同じ同期先への実行は直列化し、開始済みのrunを自動キャンセルしません。

### 3.3 ローカルからの実行

障害調査などでローカルから実行する場合は、値をshell historyへ残しません。

Preview（値をshell historyへ残さない）:

```bash
read -rs STRIPE_SECRET_KEY
export STRIPE_SECRET_KEY
task stripe:setup:preview
unset STRIPE_SECRET_KEY
```

Production:

```bash
read -rs STRIPE_SECRET_KEY
export STRIPE_SECRET_KEY
CONFIRM_STRIPE_LIVE=production task stripe:setup:production
unset STRIPE_SECRET_KEY
```

Stripeだけを同期し、Cloudflareを変更しない確認には`--stripe-only`を使います。

```bash
bun scripts/setup-stripe-billing.ts preview --stripe-only
```

### 3.3 契約ライフサイクルのsandbox確認

通常PRのCIはStripeへ接続しません。実接続の回帰は`scheduled-checks.yml`の手動・定期実行で、`apps/api/scripts/test-billing-lifecycle.ts`からsandbox Test Clockを使って確認します。

実行には`dev` GitHub Environmentの`STRIPE_SECRET_KEY`を設定し、先にStripe catalog同期を完了します。E2Eは料金SSoTのLite・Full月額lookup keyを使い、trial、通常更新、即時upgrade、期間末downgrade、支払失敗と回復、解約予約・取消・終了を再現します。通常CIでは、同じprojectionに対するWebhook重複、順序逆転、subscription event欠落時のCustomer再照合、最終retryのDLQ遷移をfakeで回帰します。

## 4. Cloudflareへ配布する値

通常実行はWranglerの標準入力を使い、値をコマンド引数やログへ出さずに次を同期します。

| 値 | API | Worker |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Webhook署名検証、管理用再照合、後続Checkout API | QueueからStripeの現在状態を再取得 |
| `STRIPE_WEBHOOK_SECRET` | `Stripe-Signature`検証 | 不要 |
| `STRIPE_PORTAL_CONFIGURATION_ID` | 管理対象のCustomer Portal設定をSession作成時に指定 | 不要 |
| `STRIPE_PORTAL_PLAN_CHANGE_CONFIGURATION_ID` | 現在の請求期間を維持する変更確認用Portal設定 | 不要 |
| `STRIPE_PORTAL_RESET_CONFIGURATION_ID` | 月額から年額へのupgradeで請求期間を変更日にリセットするPortal設定 | 不要 |
| `BILLING_PRICE_PLAN_MAP` | 後続Checkout API用 | Price IDをprovider非依存Planへ変換 |
| `BILLING_LOOKUP_KEY_MAP` | CheckoutでPlanと請求間隔を許可済みlookup keyへ変換 | いいえ |
| `BILLING_PROJECTION_STALE_AFTER_SECONDS` | 監視でprojection遅延と判定する猶予秒数（既定900） | いいえ |

Webhook secretはendpoint作成時にだけStripeから返ります。初回実行ではその値を自動配布します。Cloudflareに`STRIPE_WEBHOOK_SECRET`という名前のsecretが無い場合は、前回の配布失敗からも復旧できるようendpointをローテーションして新しいsecretを配布します。既存値を意図的に置き換える場合は、既知の値を`STRIPE_WEBHOOK_SECRET`へ設定して実行します。

## 5. 冪等性と価格変更

同じ設定で再実行してもProduct、Price、Webhook、Portalを追加しません。管理対象と同じProduct IDを管理外資源が使用している場合や、同じWebhook URLが複数ある場合は、推測で上書きせず停止します。

Stripe Priceの金額と課金間隔は変更できません。料金SSoTを変更した場合、同期処理は次の順で切り替えます。

1. 新しいPriceを作成する
2. `transfer_lookup_key=true`で固定lookup keyを新Priceへ移す
3. 旧Priceを新規購入不可にする
4. 旧Price IDを`BILLING_PRICE_PLAN_MAP`へ残す

既存Subscriptionは旧Priceを参照したまま継続でき、projectionも旧Priceを正しいPlanへ変換できます。旧Priceは既存契約がなくなるまで削除しません。

## 6. 実行後の確認

- 終了コードが0である
- 出力の`created` / `updated`が意図した対象だけである
- `billingPricePlanMap`に現在の6 Priceと、既存契約が参照する旧Priceが含まれる
- PreviewのStripe webhookから署名付きeventを送り、Billing Queueへ受理される
- 同じコマンドを再実行してProduct、Price、Webhook、Portalの数が増えない

この同期は課金開始の承認ではありません。本番で購入を公開する前に、`SUB-A-001`、Checkout以降の契約ライフサイクル、公開表示、法務・税務、Preview実取引の各ゲートを完了させます。
