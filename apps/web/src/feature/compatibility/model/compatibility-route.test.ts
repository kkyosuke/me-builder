import { describe, expect, it } from "vitest";
import {
  resolveCompatibilityInvitationId,
  resolveCompatibilityPathname,
  resolveCompatibilityRelationshipId,
  resolveCompatibilityRoute,
} from "./compatibility-route";

describe("compatibility route", () => {
  it.each([
    ["/compatibility", "list"],
    ["/compatibility/share", "share"],
    ["/compatibility/invitations/demo", "invitation"],
    [`/compatibility/relationships/${"a".repeat(64)}`, "result"],
  ] as const)("%sを%s画面として解決する", (pathname, route) => {
    expect(resolveCompatibilityRoute(pathname)).toBe(route);
  });

  it("256 bitの相性関係IDだけをパスから取り出す", () => {
    expect(
      resolveCompatibilityRelationshipId(`/compatibility/relationships/${"b".repeat(64)}`),
    ).toBe("b".repeat(64));
    expect(resolveCompatibilityRelationshipId("/compatibility/relationships/demo")).toBeNull();
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
