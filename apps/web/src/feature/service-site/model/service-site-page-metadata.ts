import { currentServiceTerms } from "@me-builder/shared";
import type { ServiceSiteRoute } from "./service-site-route";

export type ServiceSitePageMetadata = Readonly<{
  pathname: string;
  title: string;
  description: string;
  robots: "index,follow" | "noindex,nofollow";
}>;

export const serviceSitePageMetadata = {
  "commercial-transactions": {
    pathname: "/commercial-transactions",
    title: "特定商取引法に基づく表記｜かがみ",
    description: "かがみの有料プランに関する料金、支払、解約、返金条件をご案内します。",
    robots: "index,follow",
  },
  contact: {
    pathname: "/contact",
    title: "お問い合わせ｜かがみ",
    description: "かがみのサービス運用者へのお問い合わせ方法と注意事項をご案内します。",
    robots: "index,follow",
  },
  home: {
    pathname: "/",
    title: "かがみ｜日記と診断で、自分を少しずつ知る",
    description:
      "LINEの日記とWebの診断から、自分の考え方や大切にしていることを少しずつ整理し、振り返るサービスです。",
    robots: "index,follow",
  },
  privacy: {
    pathname: "/privacy",
    title: "プライバシーポリシー｜かがみ",
    description: "かがみで扱う情報、利用目的、外部送信、保存、安全管理をご案内します。",
    robots: "index,follow",
  },
  terms: {
    pathname: "/terms",
    title: `${currentServiceTerms.title}｜かがみ`,
    description: "かがみの現在のサービス利用規約を、ログインせずに確認できます。",
    robots: "index,follow",
  },
} as const satisfies Record<ServiceSiteRoute, ServiceSitePageMetadata>;
