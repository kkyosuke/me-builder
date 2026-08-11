import type { ProfileSummaryEvidence } from "@me-builder/lib";
import { describe, expect, it } from "vitest";
import { validateGeneratedProfileSummary } from "./profile-summary";

const evidence: ProfileSummaryEvidence[] = [
  {
    id: "brain:diagnosis-1",
    source: "diagnosis",
    text: "予定を立てることを好む",
    recordedAt: new Date("2026-08-01T00:00:00.000Z"),
  },
  {
    id: "diary:source-1",
    source: "diary",
    text: "Memory化されていない日記本文",
    recordedAt: new Date("2026-08-08T00:00:00.000Z"),
  },
];

describe("validateGeneratedProfileSummary", () => {
  it("提示した診断・日記の根拠IDを表示用の種別と件数へ変換する", () => {
    expect(
      validateGeneratedProfileSummary(
        JSON.stringify({
          headline: "見通しと日々の実感を大切にしています",
          insights: [
            {
              key: "planning",
              label: "見通しを持つ",
              description: "予定と日々の実感を手がかりにする傾向があります。",
              evidence_ids: ["brain:diagnosis-1", "diary:source-1"],
            },
          ],
          compatibility_share: {
            statements: [
              {
                key: "planning-style",
                label: "見通しを持つ",
                statement: "私は、先の見通しを持って動くことを大切にしています",
                evidence_ids: ["brain:diagnosis-1", "diary:source-1"],
              },
            ],
          },
        }),
        evidence,
      ),
    ).toEqual({
      headline: "見通しと日々の実感を大切にしています",
      insights: [
        {
          key: "planning",
          label: "見通しを持つ",
          description: "予定と日々の実感を手がかりにする傾向があります。",
          evidenceCount: 2,
          sources: ["diagnosis", "diary"],
        },
      ],
      compatibilityShareStatements: [
        {
          key: "planning-style",
          label: "見通しを持つ",
          statement: "私は、先の見通しを持って動くことを大切にしています",
          evidenceIds: ["brain:diagnosis-1", "diary:source-1"],
        },
      ],
    });
  });

  it("提示していない根拠IDと重複した根拠IDを拒否する", () => {
    for (const evidenceIds of [["unknown"], ["diary:source-1", "diary:source-1"]]) {
      expect(
        validateGeneratedProfileSummary(
          JSON.stringify({
            headline: "まとめ",
            insights: [
              {
                key: "invalid",
                label: "不正",
                description: "不正な根拠です。",
                evidence_ids: evidenceIds,
              },
            ],
            compatibility_share: {
              statements: [
                {
                  key: "valid-share",
                  label: "共有用",
                  statement: "私は、考える時間を大切にしています",
                  evidence_ids: ["brain:diagnosis-1"],
                },
              ],
            },
          }),
          evidence,
        ),
      ).toBeUndefined();
    }
  });

  it("共有用文章でも提示していない根拠IDと重複した根拠IDを拒否する", () => {
    for (const evidenceIds of [["unknown"], ["diary:source-1", "diary:source-1"]]) {
      expect(
        validateGeneratedProfileSummary(
          JSON.stringify({
            headline: "まとめ",
            insights: [
              {
                key: "valid",
                label: "有効",
                description: "有効な根拠です。",
                evidence_ids: ["brain:diagnosis-1"],
              },
            ],
            compatibility_share: {
              statements: [
                {
                  key: "invalid-share",
                  label: "共有用",
                  statement: "私は、考える時間を大切にしています",
                  evidence_ids: evidenceIds,
                },
              ],
            },
          }),
          evidence,
        ),
      ).toBeUndefined();
    }
  });
});
