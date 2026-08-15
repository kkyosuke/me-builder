import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { toTokyoLocalDate } from "../utils/tokyo-date";
import {
  currentRequiredServiceTerms,
  currentServiceTerms,
  getServiceTermsDocumentsSatisfyingCurrentRequirement,
  serviceTermsDocuments,
  serviceTermsDocumentsSatisfyingCurrentRequirement,
} from "./service-terms";

describe("service terms documents", () => {
  it("versionと公開日時を一意かつ公開順で保持する", () => {
    const versions = new Set<string>();
    const hashes = new Set<string>();
    const versionsPerDate = new Map<string, number>();
    let previousPublishedAt = Number.NEGATIVE_INFINITY;

    for (const document of serviceTermsDocuments) {
      const version = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/.exec(document.version);
      expect(version, `${document.version} must be a publication date version`).not.toBeNull();
      const date = version?.[1] ?? "";
      const sequence = (versionsPerDate.get(date) ?? 0) + 1;
      versionsPerDate.set(date, sequence);
      expect(version?.[2]).toBe(sequence === 1 ? undefined : String(sequence));
      const publishedAt = Date.parse(document.publishedAt);
      expect(Number.isFinite(publishedAt)).toBe(true);
      expect(toTokyoLocalDate(publishedAt)).toBe(date);
      expect(publishedAt).toBeGreaterThan(previousPublishedAt);
      previousPublishedAt = publishedAt;

      expect(versions.has(document.version)).toBe(false);
      expect(hashes.has(document.contentHash)).toBe(false);
      versions.add(document.version);
      hashes.add(document.contentHash);
    }
    expect(serviceTermsDocuments.some((document) => document.requiresReacceptance)).toBe(true);
  });

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
    expect(serviceTermsDocuments[0]).toMatchObject({
      version: "2026-08-15",
      contentHash: "sha256:9e0143a66c525bc4784e2a6a5b0e16f511189e98b66f2da90dcb6d43cfe01836",
      publishedAt: "2026-08-15T00:00:00+09:00",
      title: "うつし サービス利用規約",
    });
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
