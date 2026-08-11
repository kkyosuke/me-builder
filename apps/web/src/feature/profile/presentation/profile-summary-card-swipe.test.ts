import { describe, expect, it } from "vitest";
import type { ProfileSummary, ProfileSummaryVersioning } from "../model/profile-summary";
import { resolveProfileSummarySwipe, summaryCardDragOffset } from "./profile-summary-card-swipe";

const summary: ProfileSummary = {
  generatedAt: "2026-08-09T12:00:00.000Z",
  headline: "まとめ",
  insights: [],
  recordCount: 0,
  diagnosisCount: 0,
  diaryCount: 0,
  latestRecordedAt: null,
};

const versioning: ProfileSummaryVersioning = {
  versions: [
    {
      id: "version-3",
      sequence: 3,
      generatedAt: "2026-08-09T12:00:00.000Z",
      isLatest: true,
      generationMethod: "ai",
      summary,
    },
    {
      id: "version-2",
      sequence: 2,
      generatedAt: "2026-08-02T12:00:00.000Z",
      isLatest: false,
      generationMethod: "ai",
      summary: { ...summary, generatedAt: "2026-08-02T12:00:00.000Z" },
    },
  ],
  selectedVersionId: "version-3",
  generation: { status: "idle", canRegenerate: true, reasons: ["brain"] },
};

describe("profile summary card swipe", () => {
  it("最新版を左へスワイプすると1つ前の版を選ぶ", () => {
    expect(
      resolveProfileSummarySwipe({ deltaX: -90, deltaY: 4, versioning, canRegenerate: true }),
    ).toEqual({ type: "select", versionId: "version-2" });
  });

  it("過去版を右へスワイプすると1つ新しい版を選ぶ", () => {
    expect(
      resolveProfileSummarySwipe({
        deltaX: 90,
        deltaY: 4,
        versioning: { ...versioning, selectedVersionId: "version-2" },
        canRegenerate: false,
      }),
    ).toEqual({ type: "select", versionId: "version-3" });
  });

  it("最新版を右へスワイプすると新しい版を生成する", () => {
    expect(
      resolveProfileSummarySwipe({ deltaX: 90, deltaY: 4, versioning, canRegenerate: true }),
    ).toEqual({ type: "regenerate" });
  });

  it("短い横移動と縦スクロールでは操作を確定しない", () => {
    expect(
      resolveProfileSummarySwipe({ deltaX: 60, deltaY: 0, versioning, canRegenerate: true }),
    ).toEqual({ type: "none" });
    expect(
      resolveProfileSummarySwipe({ deltaX: 90, deltaY: 100, versioning, canRegenerate: true }),
    ).toEqual({ type: "none" });
    expect(summaryCardDragOffset(90, 100)).toBe(0);
  });
});
