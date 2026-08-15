import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const documentHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("Web document branding", () => {
  it("ブラウザUIにかがみの名称を表示する", () => {
    expect(documentHtml).toContain("<title>かがみ</title>");
    expect(documentHtml).not.toContain("<title>me-builder</title>");
  });

  it("存在しないVite標準faviconを参照しない", () => {
    expect(documentHtml).not.toContain("/vite.svg");
    expect(documentHtml).toContain('href="/images/service/favicon.png"');
    expect(documentHtml).toContain('href="/images/service/apple-touch-icon.png"');
  });

  it("本人向けルートをHTTP responseでも検索対象外にする", () => {
    const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");

    expect(headers).toContain("/app*");
    expect(headers).toContain("/compatibility*");
    expect(headers).toContain("X-Robots-Tag: noindex, nofollow");
  });
});
