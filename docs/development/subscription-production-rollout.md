# SubscriptionのProduction段階公開

## 1. 目的と前提

この文書は将来、有料PlanをProductionへ公開するときの段階公開手順を所有します。初期ProductionはFreeだけを提供し、有料Plan、価格、無料トライアル、購入・契約管理UIを公開しません。Stripe catalogと課金実装はPreview検証用として保持します。

Productionで開始する前に、決済側のPreview検証、公開価格・規約・税務確認、監視・復旧手順、Plan機能のPreview検証がすべて完了している必要があります。この文書とrelease controlの追加だけではProduction公開を許可しません。

## 2. 公開段階と変更

| stage | 新規購入できる利用者 | 進行条件 |
| --- | --- | --- |
| `stopped` | なし | 初期状態または緊急停止。既存契約は継続する |
| `operators` | 運営Account | 実取引とsupport導線を運営自身で完了する |
| `invited` | 運営Accountと明示招待Account | 少数利用者の問い合わせと費用を処理できる |
| `public` | 全Account | 30日指標と重大障害が許容範囲にある |

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

停止後は購入入口とserver側gateの両方が拒否することを確認し、既存のLite、Full、Family Accountで利用権限と解約導線が残ることを確認します。原因を修正し、Previewと運営Accountで再検証した後、保存された`resumeStage`へ再開します。再開先を推測できない場合は`operators`からやり直します。

## 5. 30日・90日の価格検証

同じ定義で30日と90日を集計します。母数が0の指標は0%と推測せず`null`にします。

| 指標 | 定義 |
| --- | --- |
| 有料継続率 | 期間開始時の有料Accountのうち期間末も有料のAccount数 / 期間開始時有料Account数 |
| Plan変更率 | 期間内のPlan変更件数 / 期間開始時有料Account数 |
| 支払失敗率 | 失敗した更新試行数 / 全更新試行数 |
| AI変動費 | Gemini等の期間内概算費用 / 期間内有料Account数 |
| 不快評価率 | 明示的な不快評価数 / 評価総数 |

集計入力は件数と費用だけとし、Account ID、日記、診断、チャット、評価本文を含めません。Plan別の判断に必要な場合も5件未満のcohortは表示せず、個人を推測できる切り口を追加しません。30日判定で対象拡大の可否を決め、90日判定で価格維持・改定・提供停止を判断します。

## 6. Go / Stop判定

各段階の開始前に、責任者が次を記録します。

- 前提タスクと直前stageの検証結果
- 金額・税・請求書・入金・解約・返金の突合結果
- 30日または90日の5指標と母数
- 未解決の重大障害、問い合わせ、法務・税務上の懸念
- `go`、`hold`、`stop`の判断、承認者、次回確認日

閾値は実データを見る前に責任者が承認し、結果に合わせて後付けで変えません。ProductionのSecret、価格、公開stageを変更する操作はこのPRの自動テストには含めません。
