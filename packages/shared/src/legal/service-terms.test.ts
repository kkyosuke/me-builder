import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  currentRequiredServiceTerms,
  currentServiceTerms,
  getServiceTermsDocumentsSatisfyingCurrentRequirement,
  serviceTermsDocuments,
  serviceTermsDocumentsSatisfyingCurrentRequirement,
} from "./service-terms";

describe("service terms documents", () => {
  it("公開済み本文と運用属性に一致するSHA-256を保持する", () => {
    for (const document of serviceTermsDocuments) {
      const { contentHash, ...content } = document;
      const expected = `sha256:${createHash("sha256")
        .update(JSON.stringify(content))
        .digest("hex")}`;
      expect(contentHash).toBe(expected);
    }
  });

  it("最新の同意必須version以降を有効な同意対象にする", () => {
    expect(serviceTermsDocumentsSatisfyingCurrentRequirement[0]).toBe(currentRequiredServiceTerms);
    expect(serviceTermsDocumentsSatisfyingCurrentRequirement).toContain(currentServiceTerms);
  });

  it("最新規約ではサービス名をかがみとし、公開済みの旧版は変更しない", () => {
    expect(currentServiceTerms).toMatchObject({
      version: "2026-08-15-2",
      title: "かがみ サービス利用規約",
    });
    expect(currentServiceTerms.summary).toContain("かがみは");
    expect(serviceTermsDocuments[0]?.title).toBe("うつし サービス利用規約");
  });

  it("軽微改定では改定前の同意を継続して有効にする", () => {
    const important = {
      ...currentServiceTerms,
      version: "2026-08-15",
      contentHash: `sha256:${"1".repeat(64)}` as const,
      requiresReacceptance: true,
    };
    const minor = {
      ...currentServiceTerms,
      version: "2026-08-16",
      contentHash: `sha256:${"2".repeat(64)}` as const,
      requiresReacceptance: false,
    };

    expect(getServiceTermsDocumentsSatisfyingCurrentRequirement([important, minor])).toEqual([
      important,
      minor,
    ]);
  });

  it("重要改定では改定前の同意を無効にし、以降の軽微改定だけを有効にする", () => {
    const first = {
      ...currentServiceTerms,
      version: "2026-08-15",
      contentHash: `sha256:${"1".repeat(64)}` as const,
      requiresReacceptance: true,
    };
    const minor = {
      ...currentServiceTerms,
      version: "2026-08-16",
      contentHash: `sha256:${"2".repeat(64)}` as const,
      requiresReacceptance: false,
    };
    const important = {
      ...currentServiceTerms,
      version: "2026-09-01",
      contentHash: `sha256:${"3".repeat(64)}` as const,
      requiresReacceptance: true,
    };
    const latestMinor = {
      ...currentServiceTerms,
      version: "2026-09-02",
      contentHash: `sha256:${"4".repeat(64)}` as const,
      requiresReacceptance: false,
    };

    expect(
      getServiceTermsDocumentsSatisfyingCurrentRequirement([first, minor, important, latestMinor]),
    ).toEqual([important, latestMinor]);
  });
});
