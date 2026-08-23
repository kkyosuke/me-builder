import { describe, expect, it } from "vitest";
import { serviceSitePageMetadata } from "../src/feature/service-site/model/service-site-page-metadata";
import {
  renderServiceSiteDocument,
  serviceSiteEntrypointFilename,
} from "./generate-service-site-entrypoints";

const source = "<!doctype html><html><head><title>かがみ</title>  </head><body></body></html>";

describe("renderServiceSiteDocument", () => {
  it.each([
    ["/", "index.html"],
    ["/terms", "terms.html"],
    ["/privacy", "privacy.html"],
    ["/contact", "contact.html"],
    ["/commercial-transactions", "commercial-transactions.html"],
  ])("%sを末尾slashへのredirectが不要なentrypointへ変換する", (pathname, expected) => {
    expect(serviceSiteEntrypointFilename(pathname)).toBe(expected);
  });

  it("初期HTMLへ検索・共有メタデータを埋め込む", () => {
    const result = renderServiceSiteDocument(
      source,
      serviceSitePageMetadata.home,
      "https://kagami.example.com",
    );

    expect(result).toContain(`<title>${serviceSitePageMetadata.home.title}</title>`);
    expect(result).toContain('name="robots" content="index,follow"');
    expect(result).toContain('rel="canonical" href="https://kagami.example.com/"');
    expect(result).toContain('property="og:image"');
  });

  it("利用規約の初期HTMLへ固有metadataを埋め込む", () => {
    const result = renderServiceSiteDocument(
      source,
      serviceSitePageMetadata.terms,
      "https://kagami.example.com",
    );

    expect(result).toContain(`<title>${serviceSitePageMetadata.terms.title}</title>`);
    expect(result).toContain('rel="canonical" href="https://kagami.example.com/terms"');
  });

  it("レビュー中のプライバシー画面を初期HTMLから検索対象外にする", () => {
    const result = renderServiceSiteDocument(
      source,
      serviceSitePageMetadata.privacy,
      "https://kagami.example.com",
    );

    expect(result).toContain('name="robots" content="noindex,nofollow"');
    expect(result).toContain('rel="canonical" href="https://kagami.example.com/privacy"');
  });

  it("実送信レビュー前のお問い合わせ画面を初期HTMLから検索対象外にする", () => {
    const result = renderServiceSiteDocument(
      source,
      serviceSitePageMetadata.contact,
      "https://kagami.example.com",
    );

    expect(result).toContain('name="robots" content="noindex,nofollow"');
    expect(result).toContain('rel="canonical" href="https://kagami.example.com/contact"');
  });

  it("Free限定中の特商法画面を非JS初期HTMLでも検索対象外にする", () => {
    const result = renderServiceSiteDocument(
      source,
      serviceSitePageMetadata["commercial-transactions"],
      "https://kagami.example.com",
    );

    expect(result).toContain('name="robots" content="noindex,nofollow"');
    expect(result).not.toMatch(/Lite|Full|ファミリーパック|月額|年額|トライアル/u);
    expect(result).toContain(
      'rel="canonical" href="https://kagami.example.com/commercial-transactions"',
    );
  });
});
