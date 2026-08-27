import { describe, expect, it } from "vitest";
import { resolveWebApplicationRoute } from "./web-application-route";

describe("resolveWebApplicationRoute", () => {
  it.each([
    ["/", "diagnosis"],
    ["/diagnosis", "diagnosis"],
    ["/diagnosis/money-values", "diagnosis"],
    ["/diagnosis/money-values/answers/", "diagnosis"],
    ["/compatibility/invitations/invite-id", "compatibility"],
    ["/compatibility/relationships/relationship-id", "compatibility"],
    ["/me/self-care", "me"],
    ["/profile/photos/entry-id", "profile"],
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
    "/me/self-care-anything",
    "/compatibility/invitations/id/extra",
    "/diagnosis/id/unknown",
  ])("未知またはprefix衝突の%sを受理しない", (pathname) => {
    expect(resolveWebApplicationRoute(pathname)).toBe("not-found");
  });
});
