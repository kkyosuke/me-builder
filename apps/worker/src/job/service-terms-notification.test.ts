import { describe, expect, it } from "vitest";
import { buildServiceTermsAnnouncementText } from "./service-terms-notification";

describe("buildServiceTermsAnnouncementText", () => {
  it("個人情報を含めず適用日と規約導線を案内する", () => {
    const text = buildServiceTermsAnnouncementText({
      effectiveAt: "2026-09-10T00:00:00+09:00",
      summary: "データの取扱いを変更します。",
      liffId: "liff-public",
    });
    expect(text).toContain("適用日: 2026-09-10");
    expect(text).toContain("https://liff.line.me/liff-public/terms");
    expect(text).toContain("適用日までは現在の規約で利用できます");
  });
});
