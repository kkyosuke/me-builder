import { describe, expect, it } from "vitest";
import { resolveCompatibilityRoute } from "./compatibility-route";

describe("compatibility route", () => {
  it.each([
    ["/compatibility", "list"],
    ["/compatibility/share", "share"],
    ["/compatibility/invitations/demo", "invitation"],
    ["/compatibility/demo", "result"],
  ] as const)("%sを%s画面として解決する", (pathname, route) => {
    expect(resolveCompatibilityRoute(pathname)).toBe(route);
  });
});
