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
  {
    id: "diary:source-2",
    source: "diary",
    text: "海辺を長く歩いて気持ちが落ち着いたことを日記に書いた",
    recordedAt: new Date("2026-08-09T00:00:00.000Z"),
  },
];

function generatedWithShare({
  evidenceIds = ["brain:diagnosis-1"],
  label,
  statement,
}: {
  evidenceIds?: string[];
  label: string;
  statement: string;
}): string {
  return JSON.stringify({
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
          key: "share",
          label,
          statement,
          evidence_ids: evidenceIds,
        },
      ],
    },
  });
}

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

  it.each([
    {
      name: "日時",
      label: "予定の立て方",
      statement: "私は、昨日の出来事を振り返ることを大切にしています",
    },
    {
      name: "人物名",
      label: "人との時間",
      statement: "私は、田中さんとの時間を大切にしています",
    },
    {
      name: "場所",
      label: "落ち着く時間",
      statement: "私は、新宿駅で過ごす時間を大切にしています",
    },
    {
      name: "健康状態",
      label: "体調との向き合い方",
      statement: "私は、通院しながら休むことを大切にしています",
    },
    {
      name: "引用",
      label: "考え方",
      statement: "私は、「無理しない」という言葉を大切にしています",
    },
    {
      name: "相手への要求",
      label: "関わり方",
      statement: "私は、相手に早めに相談してほしいです",
    },
    {
      name: "一人称形式ではない文章",
      label: "考え方",
      statement: "先の見通しを持つことを大切にしています",
    },
  ])("共有禁止内容を含む生成文章を拒否する: $name", ({ label, statement }) => {
    expect(
      validateGeneratedProfileSummary(generatedWithShare({ label, statement }), evidence),
    ).toBeUndefined();
  });

  it("日記や記憶の長い一節を共有用文章へ転記した生成結果を拒否する", () => {
    expect(
      validateGeneratedProfileSummary(
        generatedWithShare({
          evidenceIds: ["diary:source-2"],
          label: "落ち着く時間",
          statement: "私は、海辺を長く歩いて気持ちが落ち着いたことを大切にしています",
        }),
        evidence,
      ),
    ).toBeUndefined();
  });
});
