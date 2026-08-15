import type { WeeklyReflectionGenerationContext } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerConfig } from "../config";
import { generateWeeklyReflection } from "./weekly-reflection";

const { generateStructuredResponse } = vi.hoisted(() => ({ generateStructuredResponse: vi.fn() }));
vi.mock("../infrastructure/gemini-client", () => ({
  createGeminiClient: vi.fn(() => ({})),
  generateStructuredResponse,
}));

const config = {
  googleVertexAiApiKey: "test-key",
  geminiModel: "test-model",
} as WorkerConfig;

function context(diaryCount: number): WeeklyReflectionGenerationContext {
  return {
    generationId: "generation-1",
    weekStart: "2026-08-10",
    evidence: Array.from({ length: diaryCount }, (_, index) => ({
      id: `diary:${index}`,
      source: "diary" as const,
      text: `日記${index}`,
      recordedAt: new Date(`2026-08-${12 + index}T00:00:00.000Z`),
    })),
  };
}

describe("generateWeeklyReflection", () => {
  beforeEach(() => generateStructuredResponse.mockReset());

  it("十分な日記から順序付き3項目を生成し、提示していない根拠を拒否する", async () => {
    generateStructuredResponse.mockResolvedValue({
      text: JSON.stringify({
        headline: "今週の振り返り",
        items: [
          {
            kind: "pattern",
            title: "出来事",
            description: "よく歩きました",
            evidence_ids: ["diary:0"],
          },
          {
            kind: "value",
            title: "大切なこと",
            description: "休む時間を大切にしました",
            evidence_ids: ["diary:1"],
          },
          {
            kind: "next-step",
            title: "次の一歩",
            description: "短く休むことも選べます",
            evidence_ids: ["diary:0", "diary:1"],
          },
        ],
      }),
    });
    await expect(generateWeeklyReflection(context(2), config)).resolves.toMatchObject({
      type: "generated",
      items: [
        { kind: "pattern", evidenceCount: 1 },
        { kind: "value", evidenceCount: 1 },
        { kind: "next-step", evidenceCount: 2 },
      ],
    });

    generateStructuredResponse.mockResolvedValue({
      text: JSON.stringify({
        headline: "不正",
        items: [
          {
            kind: "question",
            title: "質問",
            description: "どうでしたか？",
            evidence_ids: ["unknown"],
          },
        ],
      }),
    });
    await expect(generateWeeklyReflection(context(1), config)).resolves.toEqual({
      type: "failed",
      reason: "evidence_invalid",
    });
  });

  it("入力が少ない週は無理に傾向を作らず短い問いだけを許可する", async () => {
    generateStructuredResponse.mockResolvedValue({
      text: JSON.stringify({
        headline: "記録された範囲から",
        items: [
          {
            kind: "question",
            title: "話せること",
            description: "心に残った場面はありますか？",
            evidence_ids: ["diary:0"],
          },
        ],
      }),
    });
    await expect(generateWeeklyReflection(context(1), config)).resolves.toMatchObject({
      type: "generated",
      items: [{ kind: "question" }],
    });
  });
});
