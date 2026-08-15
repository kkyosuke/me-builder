import { describe, expect, it } from "vitest";
import { resolveServiceSiteRoute } from "./service-site-route";

describe("resolveServiceSiteRoute", () => {
  it("ルートpathnameを公開トップとして扱う", () => {
    expect(resolveServiceSiteRoute("/")).toBe("home");
  });

  it.each(["/app", "/diagnosis", "/me", "/compatibility/invitations/example"])(
    "%sは本人向けアプリとして扱う",
    (pathname) => {
      expect(resolveServiceSiteRoute(pathname)).toBeNull();
    },
  );
});
