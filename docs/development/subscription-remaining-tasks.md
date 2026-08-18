# サブスクリプション実装残タスク

## 1. 目的

この文書は、[サブスクリプション・料金プラン設計](../product/subscription-plan-design.md)を実装し、Free、Lite、Full、ファミリーパックを安全に一般提供するまでの残作業、依存順、各PRの完了条件を管理します。

### 所有する概念

- サブスクリプション実装の残タスクと着手順
- Stripeを利用する初期実装方針
- AccountとPlanを紐づけるブランチと、紐づいたPlanを利用するブランチの接続境界
- 1つのPRとしてレビューできる作業境界と完了条件
- Lite、Full、ファミリーパックそれぞれのリリースゲート

### 所有しない概念

- プラン名、価格、AI利用上限、トライアル、解約後の利用体験
- 日記チャット、関係性を考慮した質問、セルフケアの体験仕様
- Account、個人コンテンツ、複数Account間データの保存先
- 共通のログ、マイグレーション、デプロイ手順
- 法令の解釈、税務判断、会計処理

料金と利用権限は[サブスクリプション・料金プラン設計](../product/subscription-plan-design.md)、関係性を考慮した質問は[日記チャット体験設計](../product/diary-chat-experience.md)、保存先は[Accountデータ分離設計](../architecture/account-data-isolation.md)、ログは[アプリケーション運用ログ方針](operational-logging.md)、本番変更は[本番データベースマイグレーション運用](production-migration-operations.md)を正とします。

## 2. Stripe採用判断

初期の決済基盤にはStripeを採用します。Stripe Billingで月額・年額契約、Stripe Checkoutで支払情報の収集、Stripe Customer Portalで支払方法・請求履歴・プラン変更・解約、Stripe Webhookで非同期の契約状態変更を扱います。

Stripeは請求事実の正本とし、me-builder側は認証済みAccountへ紐づく契約projection、利用権限、AI利用量、ファミリー席を正本として持ちます。Stripe Customer ID、Subscription ID、Price IDなど運営に必要な識別子は共有D1へ保存し、カード番号や決済フォームの入力内容を保存しません。

初期提供ではStripe Entitlementsを利用可否判定の正本にしません。プラン別の数値上限、ファミリー参加者への権限付与、相性関係への利用権限割り当ては単純なfeature flagではないため、Stripeの契約状態をアプリ内の共通Entitlementへ変換します。すべての画面、API、Workerはこの共通判定を利用します。

StripeはWebhookの重複配信と順序逆転を前提としているため、必要なStripe objectを再取得して現在状態へ収束させます。Webhookは署名検証後にQueueへ渡して速やかに`2xx`を返し、契約projectionの更新を同期処理へ含めません。

```mermaid
flowchart LR
    U[Web / 認証済みAccount] --> A[API]
    A --> C[Stripe Checkout / Customer Portal]
    C --> S[Stripe Billing]
    S -->|署名付きWebhook| W[API Webhook受付]
    W --> Q[Billing Queue / DLQ]
    Q --> P[契約projection更新]
    P --> D[(共有D1)]
    D --> H[AccountPlanAssignment境界]
    H --> E[共通Entitlement判定]
    E --> U
    E --> K[API / Worker / AccountData利用量]
```

採用判断は2026-08-15時点の次の公式情報を前提とします。外部サービスの料金、制約、API versionは変更されるため、`SUB-A-001`、`SUB-A-004`、`SUB-A-020`で再確認します。

- [Stripeの日本向け料金](https://stripe.com/jp/pricing)
- [サブスクリプションWebhook](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Webhookのセキュリティと重複・順序の扱い](https://docs.stripe.com/webhooks)
- [Customer Portal](https://docs.stripe.com/customer-management)
- [Stripe Entitlements](https://docs.stripe.com/billing/entitlements)
- [消費者庁の通信販売における最終確認画面](https://www.caa.go.jp/policies/policy/consumer_transaction/amendment/2021/notice02/index.html)

## 3. 疎結合にする2つの枝

タスク番号は次の2系列に分けます。

| 系列 | 完了させる責務 | 扱ってよい情報 | 扱わない情報 |
| --- | --- | --- | --- |
| `SUB-A-*` | Stripeでの購入から、認証済みAccountへ現在Planを紐づけるまで | Stripe Customer / Subscription / Price、請求状態、Accountとの対応 | AI利用量、機能固有データ、プロンプト、Plan別UIの内部実装 |
| `SUB-B-*` | 紐づいたPlanを利用権限へ変換し、上限と機能へ適用する | provider非依存のPlan、適用期間、権限付与元、Account所有データ | Stripe Customer / Subscription / Price、カード・請求情報、Webhook payload |

両系列の接続点を`AccountPlanAssignment`と呼びます。これは具体的な型名を確定するものではなく、`SUB-A-002`で定義するprovider非依存の読み取り境界です。A系列はStripe状態をこの境界へ変換し、B系列はこの境界だけを読みます。

[本人入力データの訂正・削除](personal-data-api.md)と[本人データのエクスポート](personal-data-export.md)はPlanに依存しない本人データ機能です。Planに関係なく常に利用可能であることをB系列の認可testへ含めます。

- B系列はfakeの`AccountPlanAssignment`を使って、Stripe実装を待たずに開発・テストできる
- A系列はB系列の機能を呼ばず、Planの紐付けが正しいところまでを完了条件にする
- B系列はStripe ID、Stripe status、Webhook event typeを条件分岐へ利用しない
- A系列とB系列の統合は`SUB-A-020`と`SUB-B-016`を個別に確認した後、`SUB-B-017`で行う
- 境界を変更するPRはA・B双方のcontract testを更新するが、機能実装を同じPRへ含めない

```mermaid
flowchart LR
    A[SUB-A-*<br/>決済・AccountとPlanの紐付け] --> C[AccountPlanAssignment]
    F[Fake Plan Assignment] --> C
    C --> B[SUB-B-*<br/>利用権限・上限・機能]
    A --> VA[SUB-A-020<br/>決済側Preview判定]
    B --> VB[SUB-B-016<br/>機能側Preview判定]
    VA --> R[SUB-B-017<br/>統合して段階公開]
    VB --> R
```

## 4. PRの分割ルール

- 原則として、以下の1番号を1 PRとして実施する
- schema変更と、それを利用する大きな機能を同じPRへ詰め込まない
- API、Web、Workerをまたぐ項目は、利用者が確認できる小さな縦切りの場合だけ同じPRにする
- 外部I/Oはadapterを境界にし、Stripeへ接続しない自動テストを同じPRへ含める
- 後続タスクが前提にする契約や状態遷移を変える場合は、先に対応するSSoTを更新する

## 5. リリースゲート

```mermaid
flowchart TD
    A[決済側<br/>SUB-A-001〜SUB-A-020] --> I[AccountPlanAssignment]
    I --> L[Lite機能側<br/>本人データ操作]
    L --> U[Full機能側]
    U --> F[ファミリー機能側]
    F --> R[段階公開<br/>SUB-B-017]
```

決済側は`SUB-A-001`〜`SUB-A-020`で単独検証します。Liteは本人データの訂正・削除・エクスポートと関係性を考慮した質問、Fullはさらに確認済み履歴を使う関係性質問、ファミリーパックはPlanと個人内容を分離して検証してから、`SUB-B-017`で決済側と統合します。未完了のPlanは購入対象へ出しません。

## 6. 並行して着手できる前提タスク

### SUB-A-001 商取引・税務・返金条件を確定する

依存: なし

- 税込表示、課税区分、適格請求書、請求時期、日割り、返金、支払失敗時の猶予を専門家と確認する
- 決済手段登録あり・なしのどちらで14日間トライアルを開始するか決める
- 最終確認画面、特定商取引法に基づく表示、規約、プライバシーポリシーの変更点を確定する

完了条件は、Checkoutと契約状態を実装するための商取引上の未決事項がなく、料金プランのSSoTへ反映されていることです。

### SUB-A-002 課金・利用権限の実装設計を追加する

依存: `SUB-A-001`

- Stripeと共有D1の正本境界、CustomerとAccount、ファミリー支払者の対応を設計する
- Stripeの契約状態からprovider非依存の`AccountPlanAssignment`へ変換する状態遷移と読み取り境界を定義する
- Webhook、Queue、共有D1、APIをまたぐ障害時の収束方法を定義する
- fake providerとcontract testを用意し、B系列がStripe実装を待たずに利用できるようにする

完了条件は、A系列がStripe状態を紐付け、B系列がStripeへ依存せず現在Planを読める境界と課金実装のSSoTがあることです。

### SUB-A-003 有料契約を復旧できる本人確認を設計する

依存: `SUB-A-001`

- LINE Accountを失った場合の本人確認、Identity追加、既存Accountへの再接続を設計する
- StripeのメールアドレスやCustomer IDだけをAccount所有の証明にしない
- 不正な乗っ取り、重複Account、復旧不能時の解約・問い合わせ経路を定義する

完了条件は、認可境界、監査対象、失敗時の安全な結果がSSoTで決まっていることです。

## 7. ブランチA: Stripe課金基盤

### SUB-A-004 Stripe sandboxと商品catalogを再現可能にする

依存: `SUB-A-001`, `SUB-A-002`

- Local・Preview用sandboxとProductionを分離し、月額・年額Product / Priceを`lookup_key`から冪等に作成する
- Checkout、Customer Portal、必要なWebhook eventだけを環境ごとに設定する
- Secretを安全に配布し、Stripe SDKとAPI versionを固定して更新手順を記載する

完了条件は、秘密値を出力せず、空のsandboxへ同じcatalogとWebhook設定を再現できることです。

### SUB-A-005 Stripe adapterとエラー契約を追加する

依存: `SUB-A-002`

- Cloudflare Workers用Stripe clientと、Checkout、Portal、Customer、Subscriptionの最小interfaceを追加する
- timeout、network retry、idempotency key、Stripe固有エラーの原因分類を共通化する
- Customer ID、支払情報、秘密値をログへ出さず、fake adapterの単体テストを追加する

完了条件は、呼び出し側がStripe SDKのobjectや例外へ直接依存しないことです。

### SUB-A-006 共有D1へ課金projectionを追加する

依存: `SUB-A-002`

- AccountとCustomerの一意な対応、契約projection、Plan、有効期限、解約予約、最終同期情報を追加する
- 処理済みeventと古いeventによる巻き戻しを防ぐ比較情報を保存する
- 個人コンテンツを保存せず、forward-only migrationと別Accountのnegative testを追加する

完了条件は、主要なStripe契約状態を共有D1へ安全にprojectionできることです。

### SUB-A-007 Billing QueueとDLQを環境へ追加する

依存: `SUB-A-002`

- Billing Queue / DLQ、API producer、Worker consumerのbindingを追加する
- Local、Preview、Productionの作成・削除・デプロイ順へ組み込む
- retry、DLQ、message version、後方互換を既存Queue規則に合わせる

完了条件は、各環境でeventをconsumerへ配送でき、最終失敗をDLQで識別できることです。

### SUB-A-008 Stripe Webhook受付を実装する

依存: `SUB-A-005`, `SUB-A-007`

- raw bodyと`Stripe-Signature`で署名を検証し、許可したeventだけをQueueへ渡す
- 不正署名、壊れたpayload、未対応eventを安全に扱う
- 複雑な処理を待たず`2xx`を返し、payload全文をログへ出さない

完了条件は、成功・改ざん・再送をfixtureでテストし、同期的にprojectionを更新していないことです。

### SUB-A-009 Webhookから契約projectionを収束させる

依存: `SUB-A-005`〜`SUB-A-008`

- event IDと対象object / event typeで重複を防ぐ
- 到着順へ依存せず、Stripe APIから現在状態を取得してprojectionを更新する
- 作成、更新、支払成功・失敗、trial終了、解約を変換し、再配送を冪等に扱う

完了条件は、順序逆転、重複、event欠落を含むテストで同じ最終状態へ収束することです。

### SUB-A-010 Stripeと共有D1の再照合を実装する

依存: `SUB-A-009`

- Customerを指定して現在の契約を再取得する管理用actionを追加する
- Webhook欠落、DLQ、手動変更による差分をdry-runで検出し、明示操作で修復する
- 再照合から課金作成・返金・解約を勝手に実行せず、結果を監査できるようにする

完了条件は、意図的に古くしたPreview projectionを修復し、再実行で差分0になることです。

## 8. ブランチA: 購入・契約管理

### SUB-A-011 Checkout Session作成APIを実装する

依存: `SUB-A-004`〜`SUB-A-006`

- 認証済みAccountと選択したPlan / 請求間隔からSessionを作成する
- Customerを一意に再利用し、クライアント指定のCustomer IDやPrice IDを信用しない
- 二重送信、既存契約、購入不可状態、不正なreturn URLを拒否する

完了条件は、sandboxでSessionを作成し、別Account・不正Plan・二重送信を防げることです。

### SUB-A-013 Customer Portal導線を実装する

依存: `SUB-A-004`〜`SUB-A-006`

- 本人だけが自分のCustomerに対する短命なPortal Sessionを作れるAPIを追加する
- 支払方法、請求履歴、Plan変更、期間末解約を決定事項どおり設定する
- Stripe CustomerとAccountの対応がない利用者にはPortalを開かせず、反映待ちを扱う

完了条件は、別AccountのCustomerへ到達できず、本人が支払方法更新と解約予約を完了できることです。

### SUB-A-016 有料契約のAccount復旧フローを実装する

依存: `SUB-A-003`, `SUB-A-006`

- 設計済みの本人確認とIdentity再接続をAPIとWebへ実装する
- 復旧後も同じAccount IDと`AccountPlanAssignment`へ接続する
- 他Accountへの誤接続と再送による二重統合をnegative testで防ぐ

完了条件は、LINE Account喪失を想定したE2Eで、有料契約を復旧または解約できることです。

## 10. ブランチB: Lite・Fullの継続価値

### SUB-B-018 2人の振り返りの利用権限割り当てを実装する

依存: 共通Entitlement、相性共有

- 成立中の相性関係へ、参加者本人の利用権限を1つだけ割り当て・解除できるようにする
- AccountDataで同時利用数をatomicに判定し、CompatibilityDataとの途中失敗を冪等な補償処理で収束させる
- Plan終了、上限低下、ファミリー席終了、双方有料、同時操作を含むnegative testを追加する

完了条件は、別Accountやクライアント指定のPlanを信用せず、同じ関係を重複計上せずに安全側へ割り当てられることです。体験と保存境界は[相性診断・うつし共有体験設計](../product/compatibility-experience.md#544-2人の継続的な振り返り)と[相性共有データ実装設計](../architecture/compatibility-data-design.md#42-振り返りの利用権限割り当て)を正とします。

### SUB-B-019 月次比較snapshotと振り返りドメインを実装する

依存: `SUB-B-018`

- CompatibilityDataへ現在月と前月だけの表示帯snapshotを追加するforward-only migrationを作る
- 現在共有できる相性シートだけから、変化と話すテーマを決定的に組み立てる純粋ロジックを追加する
- 月境界、基準なし、変化なし、回答削除、権限終了、共有終了を単体・runtime testで確認する

完了条件は、双方の閲覧順に依存せず同じ結果になり、日記、Brain Item、非共有情報、表示文章をsnapshotへ保存しないことです。

### SUB-B-020 2人の振り返りAPI契約を実装する

依存: `SUB-B-019`

- 割り当て状態の取得・設定・解除と、現在月の振り返り取得のHTTP契約を追加する
- 認証Accountから参加者を解決し、割り当てと現在の共有範囲をサーバー側で再認可する
- 待機中、上限到達、権限なし、関係終了、依存先障害を区別し、古い振り返りへ縮退しない

完了条件は、生成型を含むcontract testと別Accountのnegative testがあり、レスポンスへAccount ID、過去の表示帯、非共有内容を含めないことです。

### SUB-B-021 2人の振り返り画面を実装する

依存: `SUB-B-020`

- 2人の相性シートへ、利用権限の割り当て状態、月ごとの変化、話すテーマを追加する
- 双方有料時に現在どちら側の権限を使っているかを示し、割り当て元本人だけへ解除操作を出す
- 基準なし、変化なし、テーマなし、権限なし、上限到達、再取得失敗をそれぞれ確認できる状態にする

完了条件は、基本の相性シートをFreeでも維持し、振り返りが双方へ同じ内容と順序で表示され、主要状態のWeb testと画面確認が完了することです。

## 11. ブランチB: ファミリーパック

## 12. 各枝の検証と統合リリース

### SUB-A-017 公開ページ・規約・通知を課金へ対応させる

依存: `SUB-A-001`, `SUB-A-015`

- 公開ページ、最終確認表示、特定商取引法に基づく表示、規約、プライバシーポリシーを更新する
- 価格、税、請求時期、自動更新、trial、解約、返金、問い合わせ先を一致させる
- 契約開始、trial終了予告、更新、支払失敗、Plan変更、解約の通知を用意する

完了条件は、公開情報とStripe設定に矛盾がなく、法務・税務確認を完了していることです。

### SUB-A-019 課金の監視・サポート・復旧手順を追加する

依存: `SUB-A-009`, `SUB-A-010`, `SUB-A-015`

- Webhook、Queue / DLQ、projection遅延、再照合差分、支払失敗を監視する
- 売上、返金、手数料、有料Account、Plan紐付け失敗を個人内容なしで確認できるようにする
- 二重請求疑い、誤Plan、解約不能、Account復旧、Secret rotationのrunbookを追加する

完了条件は、代表的な問い合わせと障害を検知・判断・復旧できることです。

### SUB-A-020 PreviewでAccountとPlanの紐付けを検証する

依存: `SUB-A-001`〜`SUB-A-019`

- [Preview検証手順](subscription-preview-plan-verification.md)の`PREVIEW-BILLING-001`〜`009`を共有Previewで実施し、識別子を含まない結果をPRへ残す
- `SUB-A-016`完了後、Account復旧後も同じPlanへ到達することを追加確認する
- `SUB-A-017`と`SUB-A-019`の未完了条件をProduction承認から除外しない

自動検証と実施手順は実装済みです。完了条件は、B系列が未完成でも、上の共有Preview実施記録とAccount復旧を含め、Stripeの契約状態とAccountのPlan紐付けが正しく収束することを証明できることです。

### SUB-B-017 Productionを段階的に公開して価格を検証する ([#303](https://github.com/kkyosuke/me-builder/pull/303))

依存: `SUB-A-020`、Plan紐付け後の機能検証

- `SUB-A-020`完了後にrelease controlをProductionのcheckoutへ接続する
- 運営Accountで実取引の金額、税表示、入金、請求書、解約、返金を突合する
- 少数招待、一般提供の順に進め、30日・90日の実測指標を承認記録へ残す

完了条件は、Productionで新規購入だけを安全に停止・再開でき、実取引と30日・90日の価格検証を完了することです。

## 13. 更新ルール

- 未完了の番号だけを残し、完了したタスクは削除する
- 実装を始めたタスクはIssueまたはPRへ移し、この文書にはリンクと未完了条件だけを残す
- 1番号が大きすぎる場合は、既存番号を変えず`SUB-A-009A`または`SUB-B-099A`のような枝番で分割する
- 新しい作業は責務に応じてA・Bどちらかの末尾へ追加し、既存番号を振り直さない
- 料金、利用権限、解約後の体験を変える場合は、先に料金プランのSSoTを更新する
- すべて完了したら、この文書とドキュメントマップのリンクを同じ変更で削除する
