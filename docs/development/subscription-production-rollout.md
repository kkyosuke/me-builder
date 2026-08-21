# SubscriptionのProduction段階公開

## 1. 目的と前提

この文書は将来、有料PlanをProductionへ公開するときの段階公開手順を所有します。初期ProductionはFreeだけを提供し、有料Plan、価格、無料トライアル、購入・契約管理UIを公開しません。Production APIは有料catalogを空で返し、trial・checkout・Plan変更の開始を`503`で拒否します。既存契約の収束に必要なWebhook、checkout状態確認、Customer Portalは閉じません。Stripe catalogと課金実装はPreview検証用として保持します。

Productionで開始する前に、決済側のPreview検証、公開価格・規約・税務確認、監視・復旧手順、Plan機能のPreview検証がすべて完了している必要があります。この文書とrelease controlの追加だけではProduction公開を許可しません。

## 2. 公開段階と変更

| stage | 新規購入できる利用者 | 進行条件 |
| --- | --- | --- |
| `stopped` | なし | 初期状態または緊急停止。既存契約は継続する |
| `operators` | 運営Account | 実取引とsupport導線を運営自身で完了する |
| `invited` | 運営Accountと明示招待Account | 少数利用者の問い合わせと費用を処理できる |
| `public` | 全Account | 運営Accountと少数招待で重大な課金障害がない |

対象拡大は一段ずつ行います。対象縮小は任意の段階へ戻せます。停止操作は直前のstageを保持し、原因解消と再確認後に同じstageへ再開します。stage変更は操作者、変更前後、時刻、理由を監査記録へ残しますが、Account IDの一覧や個人内容は記録しません。

## 3. 最初の実取引

運営Accountで実額購入し、次をStripe Dashboard、利用者画面、通知、入金明細で突合します。

- checkoutのPlan名、税込・税別表示、請求時期、自動更新、trial条件
- PaymentとInvoiceの金額、通貨、税、手数料、入金見込額
- `AccountPlanAssignment`のPlan、開始時刻、終了予定と機能側の表示
- Customer Portalからの解約と期間末までの利用、期間後のFree化
- 承認済み手順による返金、Invoice・Payment・入金差額、利用者通知

Customer ID、Subscription ID、Payment ID、Invoice IDはアクセス制限された運用記録だけに保存し、通常ログ、PR、チャット、画面録画へ転記しません。金額や税が公開情報と一致しない場合は`operators`のまま新規購入を停止します。

## 4. 緊急停止と再開

停止対象はcheckout sessionなどの**新しい購入開始だけ**です。次は停止しません。

- 既存契約からのPlan解決と有効期限内の機能
- Webhook受信、Queue / DLQ、reconciliation、支払失敗からの回復
- Customer Portal、解約、返金、本人データの訂正・削除・特徴取得
- Family参加者の退出とFreeへの復帰

停止後は購入入口とserver側gateの両方が拒否することを確認し、既存のLite、Full、Family Accountで利用権限と解約導線が残ることを確認します。同じサービス管理者が安全上必要な停止を即時実行できます。原因を修正し、Previewの再確認checklistと運営Accountでの確認を完了した後、同じ管理者が保存された`resumeStage`への再開を承認します。再開先を推測できない場合は`operators`からやり直します。

## 5. 公開後の確認

売上、返金、契約数、継続、支払失敗はStripe Dashboardを正本として必要時に確認します。同じ情報の30日・90日集計、固定した数値閾値、別の承認記録は公開条件にしません。アプリ側ではStripeから分からないprojection遅延、Queue／DLQ、未知status・Priceを管理者課金healthで確認します。AI・LINE費用は必要時に各providerで確認します。

`operators`から`invited`、`public`へ進めるときは、直前stageで重大な課金障害がなく、問い合わせと復旧を同じ管理者が処理できることを確認します。ProductionのSecret、価格、公開stageを変更する操作はこのPRの自動テストには含めません。
