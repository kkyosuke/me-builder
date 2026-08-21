export type CommercialTransactionEntry = Readonly<{
  label: string;
  value: string;
}>;

export type CommercialTransactionsDisclosure = Readonly<{
  title: string;
  summary: string;
  contact: string;
  entries: readonly CommercialTransactionEntry[];
}>;

/** 日本向け有料提供で、購入前に認証なしで確認できる通信販売条件の正本。 */
export const commercialTransactionsDisclosure = {
  title: "特定商取引法に基づく表記",
  summary:
    "有料プランをお申し込みになる前に、料金、無料トライアル、自動更新、解約、返金の条件をご確認ください。",
  contact: "support@kagami.kyosuke.dev",
  entries: [
    {
      label: "販売事業者の氏名・住所・電話番号",
      value:
        "請求があった場合、購入の判断に先立って遅滞なく電子メールで提供します。お問い合わせ先へご連絡ください。",
    },
    {
      label: "お問い合わせ先",
      value:
        "support@kagami.kyosuke.dev。対応はベストエフォートで、営業時間、回答期限、可用性は保証しません。",
    },
    {
      label: "販売価格",
      value:
        "料金プラン画面とStripe Checkoutの最終確認画面に、支払総額を日本円で表示します。表示価格には消費税相当額を含みます。",
    },
    {
      label: "販売価格以外の負担",
      value:
        "インターネット接続や通信に必要な料金は利用者の負担です。本サービスから追加の決済手数料は請求しません。",
    },
    {
      label: "支払方法と支払時期",
      value:
        "Stripeが提供するクレジットカード決済を利用します。無料トライアルを利用しない場合は申込時、無料トライアルを利用する場合は終了時に請求し、以後は選択した月次または年次の契約期間ごとに自動更新します。",
    },
    {
      label: "無料トライアル",
      value:
        "初回対象者は14日間利用できます。開始時に決済手段を登録し、開始前に表示した終了日を過ぎると、表示した料金で自動更新します。終了前に期間末解約を予約した場合は請求しません。",
    },
    {
      label: "サービスの提供時期",
      value:
        "申込みと決済手段の登録が完了し、Stripeの契約状態を確認できた後に利用できます。反映に時間がかかる場合は契約状態の再確認を案内します。",
    },
    {
      label: "プラン変更と解約",
      value:
        "契約管理画面からいつでも期間末解約を予約できます。下位プランへの変更と年額から月額への変更は現在の期間終了時、上位プランへの変更はStripeの最終確認画面に表示された条件で反映します。",
    },
    {
      label: "返金",
      value:
        "利用者都合による返金は行いません。二重請求、誤請求、またはサービス側の重大な障害があった場合は、請求事実を確認して個別に対応します。法令上必要な場合はこの限りではありません。",
    },
    {
      label: "請求書・領収書",
      value:
        "Stripeが通常の請求書と領収書を発行し、契約管理画面から確認できます。適格請求書は発行しません。",
    },
    {
      label: "課金に関する通知",
      value:
        "契約、請求、支払失敗などの課金情報はStripeのメールとWeb画面で案内し、LINEには表示しません。",
    },
  ],
} as const satisfies CommercialTransactionsDisclosure;
