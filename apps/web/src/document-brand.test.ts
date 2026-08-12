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
  });
});
