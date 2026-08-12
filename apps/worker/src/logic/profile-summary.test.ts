import type { ProfileSummaryEvidence, ProfileSummaryGenerationContext } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerConfig } from "../config";
import { generateProfileSummary, validateGeneratedProfileSummary } from "./profile-summary";

const { generateStructuredResponse } = vi.hoisted(() => ({
  generateStructuredResponse: vi.fn(),
}));
vi.mock("../infrastructure/gemini-client", () => ({
  createGeminiClient: vi.fn(() => ({})),
  generateStructuredResponse,
}));

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
      type: "valid",
      summary: {
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
      },
      rejectedShareRules: [],
    });
  });

  it("JSONとして解釈できない応答とschemaへ適合しない応答を理由付きで拒否する", () => {
    expect(validateGeneratedProfileSummary("{途中まで", evidence)).toEqual({
      type: "invalid",
      reason: "response_not_json",
    });
    expect(
      validateGeneratedProfileSummary(JSON.stringify({ headline: "まとめ" }), evidence),
    ).toEqual({ type: "invalid", reason: "response_schema_mismatch" });
  });

  it("insightの提示していない根拠IDと重複した根拠IDで版を保存しない", () => {
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
      ).toEqual({ type: "invalid", reason: "insight_evidence_invalid" });
    }
  });

  it("重複したinsightのkeyで版を保存しない", () => {
    expect(
      validateGeneratedProfileSummary(
        JSON.stringify({
          headline: "まとめ",
          insights: [
            {
              key: "duplicated",
              label: "重複",
              description: "1件目です。",
              evidence_ids: ["brain:diagnosis-1"],
            },
            {
              key: "duplicated",
              label: "重複",
              description: "2件目です。",
              evidence_ids: ["diary:source-1"],
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
    ).toEqual({ type: "invalid", reason: "insight_key_duplicated" });
  });

  it("共有用文章の根拠IDが不正な場合は、その文章だけを落として版を保存する", () => {
    for (const evidenceIds of [["unknown"], ["diary:source-1", "diary:source-1"]]) {
      expect(
        validateGeneratedProfileSummary(
          generatedWithShare({
            evidenceIds,
            label: "共有用",
            statement: "私は、考える時間を大切にしています",
          }),
          evidence,
        ),
      ).toEqual({
        type: "valid",
        summary: expect.objectContaining({ compatibilityShareStatements: [] }),
        rejectedShareRules: ["evidence_invalid"],
      });
    }
  });

  it("重複した共有用文章のkeyは後続の1件だけを落とす", () => {
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
                key: "share",
                label: "共有用",
                statement: "私は、考える時間を大切にしています",
                evidence_ids: ["brain:diagnosis-1"],
              },
              {
                key: "share",
                label: "共有用",
                statement: "私は、静かな時間を好みます",
                evidence_ids: ["brain:diagnosis-1"],
              },
            ],
          },
        }),
        evidence,
      ),
    ).toEqual({
      type: "valid",
      summary: expect.objectContaining({
        compatibilityShareStatements: [
          expect.objectContaining({ statement: "私は、考える時間を大切にしています" }),
        ],
      }),
      rejectedShareRules: ["key_duplicated"],
    });
  });

  it.each([
    {
      name: "日時",
      label: "予定の立て方",
      statement: "私は、昨日の出来事を振り返ることを大切にしています",
      rule: "forbidden_detail",
    },
    {
      name: "人物名",
      label: "人との時間",
      statement: "私は、田中さんとの時間を大切にしています",
      rule: "forbidden_detail",
    },
    {
      name: "場所",
      label: "落ち着く時間",
      statement: "私は、新宿駅で過ごす時間を大切にしています",
      rule: "forbidden_detail",
    },
    {
      name: "健康状態",
      label: "体調との向き合い方",
      statement: "私は、通院しながら休むことを大切にしています",
      rule: "forbidden_detail",
    },
    {
      name: "引用",
      label: "考え方",
      statement: "私は、「無理しない」という言葉を大切にしています",
      rule: "forbidden_detail",
    },
    {
      name: "相手への要求",
      label: "関わり方",
      statement: "私は、相手に早めに相談してほしいです",
      rule: "statement_shape",
    },
    {
      name: "一人称形式ではない文章",
      label: "考え方",
      statement: "先の見通しを持つことを大切にしています",
      rule: "statement_shape",
    },
    {
      name: "句点を含むlabel",
      label: "考え方。",
      statement: "私は、考える時間を大切にしています",
      rule: "label_shape",
    },
  ])(
    "共有禁止内容を含む生成文章を、理由を残して1件だけ落とす: $name",
    ({ label, statement, rule }) => {
      expect(
        validateGeneratedProfileSummary(generatedWithShare({ label, statement }), evidence),
      ).toEqual({
        type: "valid",
        summary: expect.objectContaining({ compatibilityShareStatements: [] }),
        rejectedShareRules: [rule],
      });
    },
  );

  it("日記や記憶の長い一節を共有用文章へ転記した生成結果を落とす", () => {
    expect(
      validateGeneratedProfileSummary(
        generatedWithShare({
          evidenceIds: ["diary:source-2"],
          label: "落ち着く時間",
          statement: "私は、海辺を長く歩いて気持ちが落ち着いたことを大切にしています",
        }),
        evidence,
      ),
    ).toEqual({
      type: "valid",
      summary: expect.objectContaining({ compatibilityShareStatements: [] }),
      rejectedShareRules: ["evidence_excerpt"],
    });
  });

  it("共有用文章が0件の応答でも、本人向けの版として保存する", () => {
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
          compatibility_share: { statements: [] },
        }),
        evidence,
      ),
    ).toEqual({
      type: "valid",
      summary: expect.objectContaining({ compatibilityShareStatements: [] }),
      rejectedShareRules: [],
    });
  });

  it("上限を超えた共有用文章は超過分だけを落とす", () => {
    const statement = (index: number) => ({
      key: `share-${index}`,
      label: `共有用${"あ".repeat(index)}`,
      statement: `私は、${"静かな時間".slice(0, 1 + index)}を好みます`,
      evidence_ids: ["brain:diagnosis-1"],
    });

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
          compatibility_share: { statements: [1, 2, 3, 4].map(statement) },
        }),
        evidence,
      ),
    ).toEqual({
      type: "valid",
      summary: expect.objectContaining({
        compatibilityShareStatements: [
          expect.objectContaining({ key: "share-1" }),
          expect.objectContaining({ key: "share-2" }),
          expect.objectContaining({ key: "share-3" }),
        ],
      }),
      rejectedShareRules: ["count_exceeded"],
    });
  });

  it("落とした共有用文章と同じkeyでも、後続の妥当な文章は残す", () => {
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
                key: "share",
                label: "共有用",
                statement: "私は、相手に早めに相談してほしいです",
                evidence_ids: ["brain:diagnosis-1"],
              },
              {
                key: "share",
                label: "共有用",
                statement: "私は、静かな時間を好みます",
                evidence_ids: ["brain:diagnosis-1"],
              },
            ],
          },
        }),
        evidence,
      ),
    ).toEqual({
      type: "valid",
      summary: expect.objectContaining({
        compatibilityShareStatements: [
          expect.objectContaining({ statement: "私は、静かな時間を好みます" }),
        ],
      }),
      rejectedShareRules: ["statement_shape"],
    });
  });
});

describe("generateProfileSummary", () => {
  const context = {
    generationId: "generation-1",
    evidence,
    diagnosisCount: 1,
    diaryCount: 2,
    latestRecordedAt: new Date("2026-08-09T00:00:00.000Z"),
    inputSnapshot: {
      diagnosis: { count: 1, latestRecordedAt: new Date("2026-08-01T00:00:00.000Z") },
      diary: { count: 2, latestRecordedAt: new Date("2026-08-09T00:00:00.000Z") },
    },
  } satisfies ProfileSummaryGenerationContext;
  const workerConfig = {
    environment: "test",
    geminiModel: "gemini-test",
    googleVertexAiApiKey: "test-key",
  } as WorkerConfig;
  const validResponse = generatedWithShare({
    label: "考える時間",
    statement: "私は、考える時間を大切にしています",
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("認証情報がない場合と根拠がない場合を、応答の不備と区別する", async () => {
    expect(
      await generateProfileSummary(context, { ...workerConfig, googleVertexAiApiKey: "" }),
    ).toEqual({ type: "failed", reason: "ai_credentials_missing" });
    expect(await generateProfileSummary({ ...context, evidence: [] }, workerConfig)).toEqual({
      type: "failed",
      reason: "evidence_empty",
    });
    expect(generateStructuredResponse).not.toHaveBeenCalled();
  });

  it("上限tokenで切れた応答を、空応答やschema不適合と区別する", async () => {
    generateStructuredResponse.mockResolvedValue({
      text: '{"headline":"まと',
      finishReason: "MAX_TOKENS",
    });

    expect(await generateProfileSummary(context, workerConfig)).toEqual({
      type: "failed",
      reason: "response_truncated",
    });
    expect(generateStructuredResponse).toHaveBeenCalledTimes(2);
  });

  it("本文のない応答は、切断の有無で理由を分ける", async () => {
    generateStructuredResponse.mockResolvedValue({ text: undefined, finishReason: "MAX_TOKENS" });
    expect(await generateProfileSummary(context, workerConfig)).toEqual({
      type: "failed",
      reason: "response_truncated",
    });

    generateStructuredResponse.mockResolvedValue({ text: "", finishReason: "STOP" });
    expect(await generateProfileSummary(context, workerConfig)).toEqual({
      type: "failed",
      reason: "response_empty",
    });
  });

  it("schemaへ適合しない応答は理由を残して作り直す", async () => {
    generateStructuredResponse
      .mockResolvedValueOnce({ text: "{}", finishReason: "STOP" })
      .mockResolvedValueOnce({ text: validResponse, finishReason: "STOP" });

    expect(await generateProfileSummary(context, workerConfig)).toEqual({
      type: "generated",
      summary: expect.objectContaining({ headline: "まとめ" }),
      rejectedShareRules: [],
    });
    expect(generateStructuredResponse).toHaveBeenCalledTimes(2);
  });

  it("最後の試行の理由を失敗結果へ残す", async () => {
    generateStructuredResponse
      .mockResolvedValueOnce({ text: "{}", finishReason: "STOP" })
      .mockResolvedValueOnce({ text: "壊れたJSON", finishReason: "STOP" });

    expect(await generateProfileSummary(context, workerConfig)).toEqual({
      type: "failed",
      reason: "response_not_json",
    });
  });
});
