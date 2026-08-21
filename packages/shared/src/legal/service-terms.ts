export type ServiceTermsSection = Readonly<{
  heading: string;
  paragraphs: readonly string[];
}>;

export type ServiceTermsDocument = Readonly<{
  documentKey: "terms_of_service";
  version: string;
  contentHash: `sha256:${string}`;
  requiresReacceptance: boolean;
  publishedAt: string;
  title: string;
  summary: string;
  sections: readonly ServiceTermsSection[];
}>;

export type ServiceTermsAnnouncement = Readonly<{
  documentVersion: string;
  announcedAt: string;
}>;

export type ServiceTermsNotice = Readonly<{
  type: "important-upcoming" | "minor-update";
  document: ServiceTermsDocument;
  effectiveAt: string;
  displayUntil: string;
}>;

export const SERVICE_TERMS_IMPORTANT_NOTICE_DAYS = 14;
export const SERVICE_TERMS_MINOR_NOTICE_DAYS = 30;
export const SERVICE_TERMS_NOTICE_POLICY_STARTED_AT = "2026-08-21T00:00:00+09:00";

const DAY_MS = 24 * 60 * 60 * 1_000;

const initialServiceTermsDocument = {
  documentKey: "terms_of_service",
  version: "2026-08-15",
  contentHash: "sha256:9e0143a66c525bc4784e2a6a5b0e16f511189e98b66f2da90dcb6d43cfe01836",
  requiresReacceptance: true,
  publishedAt: "2026-08-15T00:00:00+09:00",
  title: "うつし サービス利用規約",
  summary:
    "うつしは、LINEでの日記やWebでの診断を通じて、自分の考え方や傾向を振り返るためのサービスです。内容を確認し、同意したうえでご利用ください。",
  sections: [
    {
      heading: "1. 規約への同意",
      paragraphs: [
        "本規約は、うつし（以下「本サービス」）の利用条件を定めます。利用者は、本規約の内容を確認し、同意した場合に本サービスを利用できます。",
        "利用者が未成年者その他単独で同意できない場合は、法定代理人など必要な権限を持つ方の同意を得てください。",
      ],
    },
    {
      heading: "2. サービスの内容",
      paragraphs: [
        "本サービスは、診断への回答、LINEでの日記、利用者が入力した情報などをもとに、自己理解を助ける整理、要約、提案、相性の振り返りを提供します。",
        "本サービスの診断やAIによる出力は、医療行為、医学的診断、心理検査、法律・投資その他の専門的助言ではありません。重要な判断では、必要に応じて専門家へ相談してください。",
      ],
    },
    {
      heading: "3. AccountとLINEの利用",
      paragraphs: [
        "本人確認にはLINE LoginまたはLIFFを利用します。LINE公式アカウントを友だち追加した場合は、日記チャット、通知、日々の声かけなどのLINE機能を利用できます。",
        "LINE Accountを利用できなくなった場合、現在のサービスではAccountを復旧できないことがあります。認証情報を第三者に利用させないでください。",
      ],
    },
    {
      heading: "4. 入力情報と個人情報の取扱い",
      paragraphs: [
        "本サービスは、診断回答、日記、プロフィール、相性共有に必要な情報、利用履歴などを、サービス提供、品質・安全性の確保、不正利用の防止、障害対応のために取り扱います。",
        "AI機能の提供に必要な範囲で、入力情報を外部のAIサービスへ送信することがあります。サービス提供とは別のAI学習へ利用する場合は、本規約への同意と分けて事前に同意を求めます。",
        "相性機能など他の利用者へ情報を表示する機能では、対象と範囲を示した別の同意を求めます。初期状態で本人の情報を他の利用者へ公開しません。",
      ],
    },
    {
      heading: "5. 禁止事項",
      paragraphs: [
        "法令または公序良俗に反する行為、他者へのなりすまし、他者の権利・プライバシーを侵害する行為、サービスや他の利用者へ過度な負荷や危害を与える行為、不正アクセスや解析を目的とする行為を禁止します。",
        "第三者の機微な情報を、本人の了承なく入力しないでください。緊急通報や生命・身体の安全確保を本サービスだけに委ねないでください。",
      ],
    },
    {
      heading: "6. 提供の変更・停止",
      paragraphs: [
        "保守、障害、安全上の必要、法令への対応その他やむを得ない場合、本サービスの全部または一部を変更・中断・終了することがあります。可能な場合は、サービス内など合理的な方法で事前に案内します。",
      ],
    },
    {
      heading: "7. 利用停止",
      paragraphs: [
        "利用者が本規約に違反した場合、またはサービスと他者の安全を守るために必要な場合、事前の通知なく利用を制限または停止することがあります。",
      ],
    },
    {
      heading: "8. 知的財産権",
      paragraphs: [
        "本サービスのプログラム、デザイン、文章、画像その他のコンテンツに関する権利は、運営者または正当な権利者に帰属します。利用者が入力した内容に関する権利は利用者に残ります。利用者は、サービス提供に必要な範囲で運営者が入力内容を処理することを許諾します。",
      ],
    },
    {
      heading: "9. 保証と責任",
      paragraphs: [
        "運営者は、出力内容の完全性、正確性、特定目的への適合性や、サービスが常に中断なく利用できることを保証しません。利用者は出力を自ら確認し、自身の判断で利用します。",
        "本規約は、消費者契約法その他の適用法令により認められない範囲で運営者の責任を免除するものではありません。",
      ],
    },
    {
      heading: "10. 規約の変更",
      paragraphs: [
        "運営者は、法令の変更、サービス内容の変更その他必要な場合に本規約を変更します。利用者の権利やデータの取扱いに重要な影響がある変更では、変更後の内容と適用日を示し、改めて同意を求めます。",
        "同意記録は規約のversionごとに保存されます。公開済みversionの本文は変更せず、改定時は新しいversionとして公開します。",
      ],
    },
    {
      heading: "11. 利用終了とデータ",
      paragraphs: [
        "本人データの削除を希望する場合は、運営者がサービス内に表示する問い合わせ窓口へご連絡ください。法令上または不正利用防止・紛争対応上の保存義務がある情報は、必要な期間に限り保持することがあります。",
      ],
    },
    {
      heading: "12. 準拠法・お問い合わせ",
      paragraphs: [
        "本規約は日本法に準拠します。本サービスに関するお問い合わせは、運営者がサービス内に表示する窓口へご連絡ください。",
      ],
    },
  ],
} as const satisfies ServiceTermsDocument;

/** 公開済み本文は変更・削除せず、改定時は新しいversionを末尾へ追加する。 */
export const serviceTermsDocuments = [
  initialServiceTermsDocument,
  {
    ...initialServiceTermsDocument,
    version: "2026-08-15-2",
    contentHash: "sha256:1ba63664661455bdcd1e6e72c25768657d833c9dc44475e7276a5d862e1b1afc",
    requiresReacceptance: true,
    publishedAt: "2026-08-15T12:30:00+09:00",
    title: "かがみ サービス利用規約",
    summary:
      "かがみは、LINEでの日記やWebでの診断を通じて、自分の考え方や傾向を振り返るためのサービスです。内容を確認し、同意したうえでご利用ください。",
    sections: [
      {
        ...initialServiceTermsDocument.sections[0],
        paragraphs: [
          "本規約は、かがみ（以下「本サービス」）の利用条件を定めます。利用者は、本規約の内容を確認し、同意した場合に本サービスを利用できます。",
          initialServiceTermsDocument.sections[0].paragraphs[1],
        ],
      },
      ...initialServiceTermsDocument.sections.slice(1),
    ],
  },
  {
    ...initialServiceTermsDocument,
    version: "2026-08-20",
    contentHash: "sha256:b9e47306efe02299ab14c8c86a3691c7d3fbabf806fd0c80bb66ceedd61b9d14",
    requiresReacceptance: true,
    publishedAt: "2026-08-20T00:00:00+09:00",
    title: "かがみ サービス利用規約",
    summary:
      "かがみは、LINEでの日記やWebでの診断を通じて、自分の考え方や傾向を振り返るためのサービスです。内容を確認し、同意したうえでご利用ください。",
    sections: [
      {
        ...initialServiceTermsDocument.sections[0],
        paragraphs: [
          "本規約は、かがみ（以下「本サービス」）の利用条件を定めます。利用者は、本規約の内容を確認し、同意した場合に本サービスを利用できます。",
          "本サービスは年齢を問わず利用できます。利用者が単独で有効な同意をできない場合は、法定代理人など必要な権限を持つ方の同意を得てください。",
        ],
      },
      initialServiceTermsDocument.sections[1],
      initialServiceTermsDocument.sections[2],
      {
        ...initialServiceTermsDocument.sections[3],
        paragraphs: [
          initialServiceTermsDocument.sections[3].paragraphs[0],
          "AI機能を利用者が実行したときだけ、機能の提供に必要な最小限の入力を外部のAIサービスへ送信します。送信内容を外部AIのモデル学習には利用しません。",
          initialServiceTermsDocument.sections[3].paragraphs[2],
        ],
      },
      ...initialServiceTermsDocument.sections.slice(4, 10),
      {
        heading: "11. 本人データの確認と変更",
        paragraphs: [
          "本人データの確認や変更は、本サービスの本人向け画面に用意した機能から行います。今後、変更が必要なデータを追加する場合は、そのための画面を用意します。問い合わせだけを根拠にAccount内のデータを書き換えません。",
        ],
      },
      {
        heading: "12. 準拠法・お問い合わせ",
        paragraphs: [
          "本規約は日本法に準拠します。本サービスに関するお問い合わせは、サービス運用者が公開する support@kagami.kyosuke.dev へご連絡ください。対応はベストエフォートで、営業時間や回答期限は設けません。",
        ],
      },
    ],
  },
] as const satisfies readonly ServiceTermsDocument[];

/**
 * 重要改定を適用日前に公開するときの告知日時。
 * 2026-08-21より後に適用する重要改定は、本文と同じ変更でここへ追加する。
 */
export const serviceTermsAnnouncements: readonly ServiceTermsAnnouncement[] = [];

export const currentServiceTerms =
  serviceTermsDocuments[serviceTermsDocuments.length - 1] ?? serviceTermsDocuments[0];

/** 指定時刻までに適用済みの最新規約を返す。将来版を事前公開しても同意gateを早めない。 */
export function getEffectiveServiceTerms(
  documents: readonly ServiceTermsDocument[],
  at: Date,
): ServiceTermsDocument {
  const effective = documents.filter(
    (document) => Date.parse(document.publishedAt) <= at.getTime(),
  );
  return effective[effective.length - 1] ?? documents[0] ?? currentServiceTerms;
}

/** Web／LIFFへ表示する、適用前の重要改定または適用後30日以内の軽微改定を返す。 */
export function getServiceTermsNotice(
  documents: readonly ServiceTermsDocument[],
  announcements: readonly ServiceTermsAnnouncement[],
  at: Date,
): ServiceTermsNotice | null {
  const now = at.getTime();
  const announcementByVersion = new Map(
    announcements.map((announcement) => [announcement.documentVersion, announcement]),
  );
  const upcoming = documents
    .filter((document) => {
      const announcement = announcementByVersion.get(document.version);
      return (
        document.requiresReacceptance &&
        announcement !== undefined &&
        Date.parse(announcement.announcedAt) <= now &&
        now < Date.parse(document.publishedAt)
      );
    })
    .sort((left, right) => Date.parse(left.publishedAt) - Date.parse(right.publishedAt))[0];
  if (upcoming) {
    return {
      type: "important-upcoming",
      document: upcoming,
      effectiveAt: upcoming.publishedAt,
      displayUntil: upcoming.publishedAt,
    };
  }

  const minor = [...documents].reverse().find((document) => {
    const effectiveAt = Date.parse(document.publishedAt);
    return (
      !document.requiresReacceptance &&
      effectiveAt <= now &&
      now < effectiveAt + SERVICE_TERMS_MINOR_NOTICE_DAYS * DAY_MS
    );
  });
  if (!minor) return null;
  return {
    type: "minor-update",
    document: minor,
    effectiveAt: minor.publishedAt,
    displayUntil: new Date(
      Date.parse(minor.publishedAt) + SERVICE_TERMS_MINOR_NOTICE_DAYS * DAY_MS,
    ).toISOString(),
  };
}

/** 最後の重要改定以降に公開された、現在の利用条件を満たす同意対象を返す。 */
export function getServiceTermsDocumentsSatisfyingCurrentRequirement(
  documents: readonly ServiceTermsDocument[],
  at = new Date(),
): readonly ServiceTermsDocument[] {
  const effectiveDocuments = documents.filter(
    (document) => Date.parse(document.publishedAt) <= at.getTime(),
  );
  if (effectiveDocuments.length === 0) return [];
  let requiredDocumentIndex = 0;
  for (const [index, document] of effectiveDocuments.entries()) {
    if (document.requiresReacceptance) requiredDocumentIndex = index;
  }
  return effectiveDocuments.slice(requiredDocumentIndex);
}

/** 既存利用者が現在の利用条件を満たす同意対象。新規同意は常に最新versionへ記録する。 */
export const serviceTermsDocumentsSatisfyingCurrentRequirement =
  getServiceTermsDocumentsSatisfyingCurrentRequirement(serviceTermsDocuments, new Date());

export const currentRequiredServiceTerms =
  serviceTermsDocumentsSatisfyingCurrentRequirement[0] ?? currentServiceTerms;
