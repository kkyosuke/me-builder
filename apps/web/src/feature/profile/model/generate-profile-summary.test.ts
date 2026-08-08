import { describe, expect, it } from "vitest";
import { generateProfileSummary } from "./generate-profile-summary";
import type { ProfileRecord } from "./profile-summary";

const records: readonly ProfileRecord[] = [
  {
    id: "diagnosis-1",
    source: "diagnosis",
    title: "診断",
    recordedAt: "2026-08-01T00:00:00.000Z",
    observations: [
      { key: "shared", label: "古い表現", description: "古い説明", strength: 0.7 },
      { key: "diagnosis-only", label: "診断のみ", description: "説明", strength: 1 },
    ],
  },
  {
    id: "diary-1",
    source: "diary",
    title: "日記",
    recordedAt: "2026-08-08T00:00:00.000Z",
    observations: [
      { key: "shared", label: "新しい表現", description: "新しい説明", strength: 0.9 },
      { key: "diary-only", label: "日記のみ", description: "説明", strength: 0.5 },
    ],
  },
];

describe("generateProfileSummary", () => {
  it("複数の入力元に共通する観察をまとめ、最新の表現と根拠を返す", () => {
    const summary = generateProfileSummary(records, "2026-08-08T12:00:00.000Z");

    expect(summary).toMatchObject({
      diagnosisCount: 1,
      diaryCount: 1,
      recordCount: 2,
      latestRecordedAt: "2026-08-08T00:00:00.000Z",
    });
    expect(summary.insights[0]).toEqual({
      key: "shared",
      label: "新しい表現",
      description: "新しい説明",
      evidenceCount: 2,
      sources: ["diagnosis", "diary"],
    });
  });

  it("表示件数を3件に限定し、同じ入力から同じ順序を生成する", () => {
    const first = generateProfileSummary(records, "2026-08-08T12:00:00.000Z");
    const second = generateProfileSummary([...records].reverse(), "2026-08-08T12:00:00.000Z");

    expect(first.insights).toHaveLength(3);
    expect(second.insights.map(({ key }) => key)).toEqual(first.insights.map(({ key }) => key));
  });

  it("入力が空でも表示可能な空状態を生成する", () => {
    const summary = generateProfileSummary([], "2026-08-08T12:00:00.000Z");

    expect(summary.insights).toEqual([]);
    expect(summary.latestRecordedAt).toBeNull();
    expect(summary.headline).toContain("記録が増えると");
  });
});
