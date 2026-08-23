import type { ServiceSiteRoute } from "./service-site-route";

type ServiceSitePublicationStage = "free-only" | "paid";
type PublicationReviewStatus = "approved" | "pending";
type RobotsDirective = "index,follow" | "noindex,nofollow";

type ReviewedServiceSiteRoute = Exclude<ServiceSiteRoute, "home">;

export type ServiceSitePublicationInput = Readonly<{
  stage: ServiceSitePublicationStage;
  reviews: Readonly<Record<ReviewedServiceSiteRoute, PublicationReviewStatus>>;
}>;

export type ServiceSitePublicationPolicy = Readonly<{
  stage: ServiceSitePublicationStage;
  showCommercialTransactions: boolean;
  robots: Readonly<Record<ServiceSiteRoute, RobotsDirective>>;
}>;

/** 公開段階とレビュー結果を、料金表示と検索公開の単一境界へ変換する。 */
export function resolveServiceSitePublicationPolicy(
  input: ServiceSitePublicationInput,
): ServiceSitePublicationPolicy {
  const showCommercialTransactions =
    input.stage === "paid" && input.reviews["commercial-transactions"] === "approved";

  return {
    stage: input.stage,
    showCommercialTransactions,
    robots: {
      home: "index,follow",
      terms: robotsForReview(input.reviews.terms),
      privacy: robotsForReview(input.reviews.privacy),
      contact: robotsForReview(input.reviews.contact),
      "commercial-transactions": showCommercialTransactions ? "index,follow" : "noindex,nofollow",
    },
  };
}

function robotsForReview(review: PublicationReviewStatus): RobotsDirective {
  return review === "approved" ? "index,follow" : "noindex,nofollow";
}

/**
 * Productionの現在状態。レビュー完了をコードから推測せず、証跡が揃った変更でのみ更新する。
 */
export const currentServiceSitePublication = resolveServiceSitePublicationPolicy({
  stage: "free-only",
  reviews: {
    terms: "pending",
    privacy: "pending",
    contact: "pending",
    "commercial-transactions": "pending",
  },
});
