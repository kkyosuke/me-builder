import { describe, expect, it } from "vitest";
import { serviceSitePageMetadata } from "../src/feature/service-site/model/service-site-page-metadata";
import { renderServiceSiteDocument } from "./generate-service-site-entrypoints";

const source = "<!doctype html><html><head><title>かがみ</title>  </head><body></body></html>";

describe("renderServiceSiteDocument", () => {
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

  it("準備中のプライバシー画面を初期HTMLから検索対象外にする", () => {
    const result = renderServiceSiteDocument(
      source,
      serviceSitePageMetadata.privacy,
      "https://kagami.example.com",
    );

    expect(result).toContain('name="robots" content="noindex,nofollow"');
    expect(result).toContain('rel="canonical" href="https://kagami.example.com/privacy"');
  });

  it("準備中のお問い合わせ画面を初期HTMLから検索対象外にする", () => {
    const result = renderServiceSiteDocument(
      source,
      serviceSitePageMetadata.contact,
      "https://kagami.example.com",
    );

    expect(result).toContain('name="robots" content="noindex,nofollow"');
    expect(result).toContain('rel="canonical" href="https://kagami.example.com/contact"');
  });
});
