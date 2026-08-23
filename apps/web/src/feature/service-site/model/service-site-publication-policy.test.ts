import { describe, expect, it } from "vitest";
import {
  currentServiceSitePublication,
  resolveServiceSitePublicationPolicy,
} from "./service-site-publication-policy";

const approvedReviews = {
  terms: "approved",
  privacy: "approved",
  contact: "approved",
  "commercial-transactions": "approved",
} as const;

describe("resolveServiceSitePublicationPolicy", () => {
  it("現在のFree限定公開では有料条件を閉じ、未承認ページを検索対象外にする", () => {
    expect(currentServiceSitePublication).toEqual({
      stage: "free-only",
      showCommercialTransactions: false,
      robots: {
        home: "index,follow",
        terms: "noindex,nofollow",
        privacy: "noindex,nofollow",
        contact: "noindex,nofollow",
        "commercial-transactions": "noindex,nofollow",
      },
    });
  });

  it("レビュー済みでもFree限定中は有料条件を公開しない", () => {
    const policy = resolveServiceSitePublicationPolicy({
      stage: "free-only",
      reviews: approvedReviews,
    });

    expect(policy.showCommercialTransactions).toBe(false);
    expect(policy.robots["commercial-transactions"]).toBe("noindex,nofollow");
    expect(policy.robots.privacy).toBe("index,follow");
  });

  it("有料段階と商取引レビューの両方が揃った場合だけ有料条件を公開する", () => {
    const approved = resolveServiceSitePublicationPolicy({
      stage: "paid",
      reviews: approvedReviews,
    });
    const pending = resolveServiceSitePublicationPolicy({
      stage: "paid",
      reviews: { ...approvedReviews, "commercial-transactions": "pending" },
    });

    expect(approved.showCommercialTransactions).toBe(true);
    expect(approved.robots["commercial-transactions"]).toBe("index,follow");
    expect(pending.showCommercialTransactions).toBe(false);
    expect(pending.robots["commercial-transactions"]).toBe("noindex,nofollow");
  });
});
