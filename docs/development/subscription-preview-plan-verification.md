# Subscription課金のPreview検証

## 1. 目的

Stripe sandboxの契約状態が、認証済みAccountの`AccountPlanAssignment`とWeb表示へ正しく収束することを、通常CI、Stripe Test Clock、共有Previewの3層で確認します。B系列のAI機能が未提供であることを、決済・Plan紐付けの失敗と扱いません。

検証記録へAccount ID、LIFF token、招待token、Customer ID、Subscription ID、日記本文を転記しません。結果は検証番号、期待Plan、実際のPlan、HTTP status、成否だけを残します。

## 2. 自動検証

### 2.1 外部接続なし

```bash
task subscription:verify:preview
```

Plan別の権限、期間境界、Freeへの復帰、本人データの保持、Familyの個人内容分離、安全案内をfakeの`AccountPlanAssignment`で確認します。Webhookの重複・順序逆転・欠落とDLQ再処理、購入から現在Plan表示までのWeb E2Eは通常テストに含めます。

### 2.2 Stripe sandbox

`Scheduled Checks` workflowの`Stripe Sandbox Billing Lifecycle`は、`dev` EnvironmentのStripe test keyとTest Clockを使います。trial、更新、upgrade、期間末downgrade、支払失敗、回復、解約予約・取消・終了を通常PR CIから分離して確認します。

### 2.3 デプロイ済みPreview

Preview CDはデプロイ直後に次を実行し、API環境と公開Plan catalogがコミット済み料金SSoTに一致することを確認します。短命LIFF ID tokenがない場合も、未認証リクエストが本人処理へ入る直前まで到達することと、署名なしWebhookが設定済み経路で拒否されることを使い、D1、Billing Queue、Stripe secret、Webhook secret、6 lookup key、管理・標準変更・請求期間reset用Portal ID、Web origin、LINE Login channel IDの欠落を検出します。この構成probeはCheckoutや契約を作成しません。

```bash
task subscription:verify:deployed-preview
```

本人の短命LIFF ID tokenを安全に手元へ渡せる場合だけ、同じコマンドでtrial利用可否とprojectionの期待Planも確認できます。値をコマンド引数、履歴、ログへ残しません。

```bash
read -rs PREVIEW_BILLING_ID_TOKEN
export PREVIEW_BILLING_ID_TOKEN
PREVIEW_EXPECTED_PLAN=lite task subscription:verify:deployed-preview
unset PREVIEW_BILLING_ID_TOKEN
```

## 3. Previewへ反映する順序

1. stack最上位PRへ`deploy`ラベルを付け、Preview CDと全PRで自動実行される外部接続なしE2Eを完了する
2. `Setup / Stripe Billing`を対象branch、`dev`、確認文字列`sync-dev`で実行する
3. 同じbranchの`Scheduled Checks`を手動実行し、Stripe sandbox lifecycleを完了する
4. Preview LIFFを検証用Accountで開き、公開Plan、初回trial、決済手段の開始時登録、特定商取引法に基づく表記を確認する
5. 購入ボタンからLINEのアプリ内ブラウザにStripe Checkoutが開くことを確認する。開かない場合の直接リンクも確認してから、sandboxの支払方法だけを使ってCheckoutを完了し、復帰画面がqueryだけで成功せず、projection反映後に現在Planを表示することを確認する

Stripe同期はPlanごとの3 Product、月額・年額の6 Price、Webhook endpoint、Customer Portal configuration、Cloudflare secretsを同時に更新します。Customer Portalが要求する「1 Product内で課金間隔が一意」を満たしつつ、3 Productすべてを即時upgrade候補へ登録します。異なるProduct間の期間末downgradeはAPIがSubscription Scheduleを作成します。旧ProductのPrice IDは既存契約がなくなるまでPlan mapへ残します。

## 4. AccountとPlanの通し確認

| 検証番号 | 操作 | 合格条件 |
| --- | --- | --- |
| `PREVIEW-BILLING-001` | Free Accountで料金プランを開く | 3 Plan、月額・年額、14日trial、決済手段の開始時登録、終了後価格、自動更新、解約・返金条件へのリンクが表示される |
| `PREVIEW-BILLING-002` | LiteをCheckoutで開始して復帰する | projection反映前は待機し、反映後だけLiteと契約管理導線を表示する |
| `PREVIEW-BILLING-003` | PortalでFullへupgradeする | Stripe確定額の支払成功後にFullへ収束し、失敗時はLiteを維持する |
| `PREVIEW-BILLING-004` | Liteへdowngradeする | APIがLite ProductのPriceへのSubscription Scheduleを作成し、予約完了と適用日を表示する。期間末まではFullを維持する |
| `PREVIEW-BILLING-005` | 更新支払を失敗・回復させる | 最初の失敗から7日だけ直前Planを維持し、再通知で延長せず、成功後にactiveへ戻る |
| `PREVIEW-BILLING-006` | 期間末解約を予約・取消・再予約する | 取消後は継続し、再予約の期間末後にFreeへ戻る。本人データは残る |
| `PREVIEW-BILLING-007` | 同じWebhookを再送し、古いeventを後着させる | 重複通知を1回だけ処理し、古いeventで新しいPlanへ巻き戻らない |
| `PREVIEW-BILLING-008` | 使用済みAccountで再購入する | CustomerやPlan付与元を変えても2回目のtrialを付けない |
| `PREVIEW-BILLING-009` | 別Accountから契約管理を開く | 他AccountのCustomer、契約、請求履歴へ到達できない |
| `PREVIEW-BILLING-010` | trial開始・請求・支払失敗・解約を確認する | StripeメールとWebだけに課金情報が表示され、LINEへ課金内容が送信されない。Portalで通常の請求書・領収書を確認でき、適格請求書とは表示されない |

支払失敗の実Account確認はアクセス制限されたStripe sandboxで検証用Customerの支払方法を変更し、識別子を検証記録へ写さずに行います。期間移動とカード失敗そのものの回帰はTest Clock E2Eを正とし、共有PreviewではWebhookからprojectionと画面へ収束する境界を確認します。

## 5. 未完了ゲート

Account復旧後も同じPlanへ到達する検証は`SUB-A-016`の本人確認・Identity再接続実装後に行います。公開規約・通知は`SUB-A-017`、監視・support運用は`SUB-A-019`の完了記録を参照します。これらが未完了の間、この手順の成功をProduction課金開始の承認に使いません。

## 6. 公式仕様の再確認

2026-08-16時点で次を再確認しました。Stripeの仕様とAPI versionはPreview同期ごとに再確認します。

- [Customer Portalの設定](https://docs.stripe.com/customer-management/configure-portal): Portalで変更可能なProductとPriceを明示的に登録する。期間末downgradeは同一Product間に限られる
- [Portal deep links](https://docs.stripe.com/customer-management/portal-deep-links): 即時upgradeは`subscription_update_confirm`で確定額と支払をStripeへ委譲する
- [Test Clock API](https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage): 時刻進行後は`ready`を待ち、一度に進められる期間上限を守る
- [Subscription pending updates](https://docs.stripe.com/billing/subscriptions/pending-updates): 即時請求のupgradeは支払成功時だけ適用する
- [Stripe test cards](https://docs.stripe.com/testing): server-side testでは実カード番号でなくtest PaymentMethodを使う
