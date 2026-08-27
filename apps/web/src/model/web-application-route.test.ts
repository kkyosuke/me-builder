import { describe, expect, it } from "vitest";
import { resolveWebApplicationRoute } from "./web-application-route";

describe("resolveWebApplicationRoute", () => {
  it.each([
    ["/", "diagnosis"],
    ["/diagnosis", "diagnosis"],
    ["/diagnosis/money-values", "diagnosis"],
    ["/diagnosis/money-values/answers/", "diagnosis"],
    [`/compatibility/invitations/${"a".repeat(64)}`, "compatibility"],
    [`/compatibility/relationships/${"b".repeat(64)}`, "compatibility"],
    ["/me/self-care", "me"],
    ["/profile/photos", "profile"],
    ["/admin/statistics", "admin"],
    ["/account-recovery", "account-recovery"],
    ["/mcp/authorize", "mcp-authorization"],
  ] as const)("%sを%sとして解決する", (pathname, route) => {
    expect(resolveWebApplicationRoute(pathname)).toBe(route);
  });

  it.each([
    "/unknown",
    "/admin-old",
    "/admin/statistics/detail",
    "/profile/billing-old",
    "/profile/avatar/extra",
    "/profile/photos/entry-id",
    "/me/self-care-anything",
    "/compatibility/invitations/id/extra",
    "/compatibility/invitations/not-a-relationship-id",
    `/compatibility/relationships/${"g".repeat(64)}`,
    "/diagnosis/id/unknown",
    "/diagnosis/%E0%A4%A",
    "/diagnosis/%E0%A4%A/answers",
  ])("未知またはprefix衝突の%sを受理しない", (pathname) => {
    expect(resolveWebApplicationRoute(pathname)).toBe("not-found");
  });
});
