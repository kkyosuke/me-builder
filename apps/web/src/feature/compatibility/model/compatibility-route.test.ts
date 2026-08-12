import { describe, expect, it } from "vitest";
import {
  resolveCompatibilityInvitationId,
  resolveCompatibilityPathname,
  resolveCompatibilityRoute,
} from "./compatibility-route";

describe("compatibility route", () => {
  it.each([
    ["/compatibility", "list"],
    ["/compatibility/share", "share"],
    ["/compatibility/invitations/demo", "invitation"],
    ["/compatibility/demo", "result"],
  ] as const)("%sを%s画面として解決する", (pathname, route) => {
    expect(resolveCompatibilityRoute(pathname)).toBe(route);
  });

  it("LIFF入口ではliff.stateの相性パスを復元する", () => {
    expect(
      resolveCompatibilityPathname(
        "/",
        `?liff.state=${encodeURIComponent("/compatibility/invitations/demo?from=line")}`,
      ),
    ).toBe("/compatibility/invitations/demo");
  });

  it("256 bitの招待IDだけをパスから取り出す", () => {
    expect(resolveCompatibilityInvitationId(`/compatibility/invitations/${"a".repeat(64)}`)).toBe(
      "a".repeat(64),
    );
    expect(resolveCompatibilityInvitationId("/compatibility/invitations/demo")).toBeNull();
  });
});
