import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { toTokyoLocalDate } from "../utils/tokyo-date";
import {
  SERVICE_TERMS_IMPORTANT_NOTICE_DAYS,
  SERVICE_TERMS_NOTICE_POLICY_STARTED_AT,
  currentRequiredServiceTerms,
  currentServiceTerms,
  getEffectiveServiceTerms,
  getServiceTermsDocumentsSatisfyingCurrentRequirement,
  getServiceTermsNotice,
  serviceTermsAnnouncements,
  serviceTermsDocuments,
  serviceTermsDocumentsSatisfyingCurrentRequirement,
} from "./service-terms";

const ISO_TIMESTAMP_WITH_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** 公開済みversionの内容・運用属性を、同意証跡と照合できる状態で固定する。 */
const publishedServiceTermsHashes: Readonly<Record<string, string>> = {
  "2026-08-15": "sha256:9e0143a66c525bc4784e2a6a5b0e16f511189e98b66f2da90dcb6d43cfe01836",
  "2026-08-15-2": "sha256:1ba63664661455bdcd1e6e72c25768657d833c9dc44475e7276a5d862e1b1afc",
  "2026-08-20": "sha256:b9e47306efe02299ab14c8c86a3691c7d3fbabf806fd0c80bb66ceedd61b9d14",
};

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
      expect(document.publishedAt).toMatch(ISO_TIMESTAMP_WITH_TIMEZONE);
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

  it("告知方針開始後の重要改定を適用日の14日以上前に告知する", () => {
    const announcementByVersion = new Map(
      serviceTermsAnnouncements.map((announcement) => [announcement.documentVersion, announcement]),
    );
    for (const document of serviceTermsDocuments) {
      if (
        !document.requiresReacceptance ||
        Date.parse(document.publishedAt) <= Date.parse(SERVICE_TERMS_NOTICE_POLICY_STARTED_AT)
      ) {
        continue;
      }
      const announcement = announcementByVersion.get(document.version);
      expect(announcement, `${document.version} must have an announcement`).toBeDefined();
      expect(
        Date.parse(document.publishedAt) - Date.parse(announcement?.announcedAt ?? ""),
      ).toBeGreaterThanOrEqual(SERVICE_TERMS_IMPORTANT_NOTICE_DAYS * 24 * 60 * 60 * 1_000);
    }
  });

  it("全公開済みversionの本文と運用属性を不変のhashで保持する", () => {
    expect(Object.keys(publishedServiceTermsHashes)).toEqual(
      serviceTermsDocuments.map((document) => document.version),
    );
    for (const document of serviceTermsDocuments) {
      expect(document.contentHash).toBe(publishedServiceTermsHashes[document.version]);
    }
  });

  it("最新の同意必須version以降を有効な同意対象にする", () => {
    expect(serviceTermsDocumentsSatisfyingCurrentRequirement[0]).toBe(currentRequiredServiceTerms);
    expect(serviceTermsDocumentsSatisfyingCurrentRequirement).toContain(currentServiceTerms);
  });

  it("最新規約ではサービス名をかがみとし、公開済みの旧版は変更しない", () => {
    expect(currentServiceTerms).toMatchObject({
      version: "2026-08-20",
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
      publishedAt: "2026-08-15T00:00:00+09:00",
      contentHash: `sha256:${"1".repeat(64)}` as const,
      requiresReacceptance: true,
    };
    const minor = {
      ...currentServiceTerms,
      version: "2026-08-16",
      publishedAt: "2026-08-16T00:00:00+09:00",
      contentHash: `sha256:${"2".repeat(64)}` as const,
      requiresReacceptance: false,
    };

    expect(
      getServiceTermsDocumentsSatisfyingCurrentRequirement(
        [important, minor],
        new Date("2026-08-17T00:00:00+09:00"),
      ),
    ).toEqual([important, minor]);
  });

  it("重要改定では改定前の同意を無効にし、以降の軽微改定だけを有効にする", () => {
    const first = {
      ...currentServiceTerms,
      version: "2026-08-15",
      publishedAt: "2026-08-15T00:00:00+09:00",
      contentHash: `sha256:${"1".repeat(64)}` as const,
      requiresReacceptance: true,
    };
    const minor = {
      ...currentServiceTerms,
      version: "2026-08-16",
      publishedAt: "2026-08-16T00:00:00+09:00",
      contentHash: `sha256:${"2".repeat(64)}` as const,
      requiresReacceptance: false,
    };
    const important = {
      ...currentServiceTerms,
      version: "2026-09-01",
      publishedAt: "2026-09-01T00:00:00+09:00",
      contentHash: `sha256:${"3".repeat(64)}` as const,
      requiresReacceptance: true,
    };
    const latestMinor = {
      ...currentServiceTerms,
      version: "2026-09-02",
      publishedAt: "2026-09-02T00:00:00+09:00",
      contentHash: `sha256:${"4".repeat(64)}` as const,
      requiresReacceptance: false,
    };

    expect(
      getServiceTermsDocumentsSatisfyingCurrentRequirement(
        [first, minor, important, latestMinor],
        new Date("2026-09-03T00:00:00+09:00"),
      ),
    ).toEqual([important, latestMinor]);
  });

  it("事前公開した重要改定を適用日まで同意必須versionにしない", () => {
    const future = {
      ...currentServiceTerms,
      version: "2026-09-10",
      contentHash: `sha256:${"5".repeat(64)}` as const,
      requiresReacceptance: true,
      publishedAt: "2026-09-10T00:00:00+09:00",
    };
    const documents = [currentServiceTerms, future];
    const before = new Date("2026-09-01T00:00:00+09:00");

    expect(getEffectiveServiceTerms(documents, before)).toBe(currentServiceTerms);
    expect(getServiceTermsDocumentsSatisfyingCurrentRequirement(documents, before)).toEqual([
      currentServiceTerms,
    ]);
    expect(getEffectiveServiceTerms(documents, new Date(future.publishedAt))).toBe(future);
  });

  it("重要改定を告知日から適用日前まで表示する", () => {
    const future = {
      ...currentServiceTerms,
      version: "2026-09-10",
      contentHash: `sha256:${"6".repeat(64)}` as const,
      requiresReacceptance: true,
      publishedAt: "2026-09-10T00:00:00+09:00",
    };
    const announcements = [
      { documentVersion: future.version, announcedAt: "2026-08-27T00:00:00+09:00" },
    ];

    expect(
      getServiceTermsNotice(
        [currentServiceTerms, future],
        announcements,
        new Date("2026-08-26T23:59:59+09:00"),
      ),
    ).toBeNull();
    expect(
      getServiceTermsNotice(
        [currentServiceTerms, future],
        announcements,
        new Date("2026-08-27T00:00:00+09:00"),
      ),
    ).toMatchObject({ type: "important-upcoming", document: future });
    expect(
      getServiceTermsNotice(
        [currentServiceTerms, future],
        announcements,
        new Date(future.publishedAt),
      ),
    ).toBeNull();
  });

  it("複数の重要改定を事前公開しても直近の適用予定だけを告知する", () => {
    const first = {
      ...currentServiceTerms,
      version: "2026-09-10",
      contentHash: `sha256:${"8".repeat(64)}` as const,
      publishedAt: "2026-09-10T00:00:00+09:00",
    };
    const second = {
      ...currentServiceTerms,
      version: "2026-10-01",
      contentHash: `sha256:${"9".repeat(64)}` as const,
      publishedAt: "2026-10-01T00:00:00+09:00",
    };
    const announcements = [
      { documentVersion: first.version, announcedAt: "2026-08-20T00:00:00+09:00" },
      { documentVersion: second.version, announcedAt: "2026-08-20T00:00:00+09:00" },
    ];

    expect(
      getServiceTermsNotice(
        [currentServiceTerms, first, second],
        announcements,
        new Date("2026-08-21T00:00:00+09:00"),
      ),
    ).toMatchObject({ type: "important-upcoming", document: first });
  });

  it("軽微改定を適用日から30日間だけ非阻害通知にする", () => {
    const minor = {
      ...currentServiceTerms,
      version: "2026-09-01",
      contentHash: `sha256:${"7".repeat(64)}` as const,
      requiresReacceptance: false,
      publishedAt: "2026-09-01T00:00:00+09:00",
    };

    expect(
      getServiceTermsNotice(
        [currentServiceTerms, minor],
        [],
        new Date("2026-09-15T00:00:00+09:00"),
      ),
    ).toMatchObject({ type: "minor-update", document: minor });
    expect(
      getServiceTermsNotice(
        [currentServiceTerms, minor],
        [],
        new Date("2026-10-01T00:00:00+09:00"),
      ),
    ).toBeNull();
  });
});
