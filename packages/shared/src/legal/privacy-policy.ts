export type PrivacyPolicySection = Readonly<{
  heading: string;
  paragraphs: readonly string[];
  items?: readonly string[];
}>;

export type PrivacyPolicyDocument = Readonly<{
  version: string;
  publishedAt: string;
  effectiveAt: string;
  title: string;
  operator: string;
  contact: string;
  sections: readonly PrivacyPolicySection[];
}>;

/** 公開ページに表示する最新のプライバシーポリシー正本。 */
export const currentPrivacyPolicy: PrivacyPolicyDocument = {
  version: "2026-08-21",
  publishedAt: "2026-08-21T00:00:00+09:00",
  effectiveAt: "2026-08-21T00:00:00+09:00",
  title: "かがみ プライバシーポリシー",
  operator: "サービス運用者",
  contact: "support@kagami.kyosuke.dev",
  sections: [
    {
      heading: "1. 取得する情報",
      paragraphs: [
        "かがみは、サービスの提供に必要な範囲で、次の情報を取得します。生年月日は取得しません。",
      ],
      items: [
        "Accountと本人確認に関する情報：LINE等の認証事業者が発行する識別子、認証結果、確認済みプロフィール情報、sessionとセキュリティ情報",
        "本人が入力する情報：診断回答、日記、AI相談、評価、プロフィール、相性共有の選択と同意",
        "入力から生成する情報：Brain Itemとその特徴、わたしのまとめ、診断結果、AI応答、検索用の数値表現",
        "利用と運用に関する情報：利用日時、機能の利用回数、固定error code、表示画面、配送・処理状態",
        "問い合わせ情報：送信元メールアドレス、件名、本文、返信履歴",
      ],
    },
    {
      heading: "2. 利用目的",
      paragraphs: [
        "取得した情報は、本人確認、診断、日記、振り返り、相性共有、AI機能等の提供、セキュリティ確保、不正利用防止、障害調査、問い合わせ対応に利用します。",
        "サービス改善には、個人の入力本文ではなく、機能の利用回数、成功・失敗、固定error code等の必要最小限の情報を利用します。広告、利用者の追跡、外部AIの学習用データ提供には利用しません。",
      ],
    },
    {
      heading: "3. 外部サービスへの送信",
      paragraphs: [
        "機能の提供に必要な場合、次の委託先へ必要最小限の情報を送信します。委託先には、各社の契約とセキュリティ条件に従って情報を取り扱わせます。",
      ],
      items: [
        "LINE：本人確認、日記等のメッセージ送受信、サービスへの導線提供",
        "Google Cloud Vertex AI：利用者がAI機能を実行したときだけ、応答生成に必要な最小限の入力を処理。送信内容をGoogleのモデル学習には利用しない設定と契約を使用",
        "Cloudflare：Web、API、データ保存、Queue、セキュリティ、標準アクセスログの提供",
      ],
    },
    {
      heading: "4. 第三者提供と利用者間の共有",
      paragraphs: [
        "法令に基づく場合を除き、本人の情報を第三者へ販売しません。相性等で他の利用者へ表示するときは、共有相手と範囲を事前に示し、機能ごとに本人の同意を求めます。",
      ],
    },
    {
      heading: "5. 保存と安全管理",
      paragraphs: [
        "情報は利用目的、機能の提供、法令上の必要性に応じて保持し、不要になったものを削除します。問い合わせ本文はサービス運用者だけが確認し、対応に不要となった時点で手動削除します。Cloudflareのアクセスログは同社の標準保持期間だけ保持し、外部ログ基盤やR2へ複製しません。",
        "利用規約の重要改定へ同意していないことだけを理由に、保存済みの本人データを自動削除しません。主機能から利用できない状態で保護を続け、本人は規約へ同意せずAccountと本人データを削除できます。削除後も規約同意、請求、監査に必要な最小限の記録は法令と説明責任に必要な期間だけ保持します。",
        "通信の暗号化、認証・権限分離、保存先の分離、secretの限定、本文を含めない運用ログ等の合理的な安全管理措置を講じます。ただし、あらゆる危険を完全に防止できることは保証しません。",
      ],
    },
    {
      heading: "6. 確認と訂正",
      paragraphs: [
        "本人データの確認や変更は、本人向け画面に用意した機能から行います。今後、変更が必要なデータを追加する場合は、そのデータを変更する画面も用意します。問い合わせメールだけを根拠にAccount内のデータを書き換えません。",
      ],
    },
    {
      heading: "7. Cookie、端末保存、アクセス解析",
      paragraphs: [
        "認証とセキュリティに必要なCookie、および表示設定等を端末に保存するlocalStorageだけを使用します。広告Cookieやアクセス解析は使用しません。このため、初期提供ではCookie bannerや分析のopt-inを表示しません。",
        "ブラウザerror報告には、固定error code、画面、発生時刻、release、error種別、bundleファイル名と行・列、失敗した操作とHTTP status、online・復旧状態のうち調査に必要な項目だけを含めます。URL query、Cookie、Account識別子、入力内容、自由記述のerror messageとstackは含めません。",
      ],
    },
    {
      heading: "8. 年齢",
      paragraphs: [
        "無料で提供する現在のサービスは年齢を問わず利用でき、年齢による機能差を設けません。生年月日は取得しません。将来有料機能を提供する場合、18歳以上または保護者の同意を得たことを申告するcheckboxを購入前に設けます。確認書類の提出は求めません。",
      ],
    },
    {
      heading: "9. 改定",
      paragraphs: [
        "このページでは最新の版、制定日、適用日を公開します。利用者の権利やデータ取扱いに重要な変更がある場合は、適用日の14日以上前からWeb／LIFFで通知し、対象者へLINEで1回知らせ、必要に応じて適用日から改めて同意を求めます。意味を変えない軽微な変更はWeb／LIFFで30日間通知します。",
      ],
    },
    {
      heading: "10. 運営者とお問い合わせ",
      paragraphs: [
        "運営者はサービス運用者です。本ポリシーに関するお問い合わせは support@kagami.kyosuke.dev へお送りください。対応はベストエフォートで、営業時間や回答期限は設けません。",
      ],
    },
  ],
};
