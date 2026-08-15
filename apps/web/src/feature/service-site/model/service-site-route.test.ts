import { describe, expect, it } from "vitest";
import { resolveServiceSiteRoute } from "./service-site-route";

describe("resolveServiceSiteRoute", () => {
  it("ルートpathnameを公開トップとして扱う", () => {
    expect(resolveServiceSiteRoute("/")).toBe("home");
  });

  it("利用規約を公開ページとして扱う", () => {
    expect(resolveServiceSiteRoute("/terms")).toBe("terms");
  });

  it("プライバシーポリシーを公開ページとして扱う", () => {
    expect(resolveServiceSiteRoute("/privacy")).toBe("privacy");
  });

  it("お問い合わせを公開ページとして扱う", () => {
    expect(resolveServiceSiteRoute("/contact")).toBe("contact");
  });

  it.each(["/app", "/diagnosis", "/me", "/compatibility/invitations/example"])(
    "%sは本人向けアプリとして扱う",
    (pathname) => {
      expect(resolveServiceSiteRoute(pathname)).toBeNull();
    },
  );
});
