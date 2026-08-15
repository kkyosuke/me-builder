import { currentServiceTerms } from "@me-builder/shared";
import type { ServiceSiteRoute } from "./service-site-route";

export type ServiceSitePageMetadata = Readonly<{
  pathname: string;
  title: string;
  description: string;
  robots: "index,follow" | "noindex,nofollow";
}>;

export const serviceSitePageMetadata = {
  home: {
    pathname: "/",
    title: "かがみ｜日記と診断で、自分を少しずつ知る",
    description:
      "LINEの日記とWebの診断から、自分の考え方や大切にしていることを少しずつ整理し、振り返るサービスです。",
    robots: "index,follow",
  },
  privacy: {
    pathname: "/privacy",
    title: "プライバシーポリシー（公開準備中）｜かがみ",
    description:
      "かがみのプライバシーポリシーは公開準備中です。正式な本文の公開前に確定する項目を案内します。",
    robots: "noindex,nofollow",
  },
  terms: {
    pathname: "/terms",
    title: `${currentServiceTerms.title}｜かがみ`,
    description: "かがみの現在のサービス利用規約を、ログインせずに確認できます。",
    robots: "index,follow",
  },
} as const satisfies Record<ServiceSiteRoute, ServiceSitePageMetadata>;
