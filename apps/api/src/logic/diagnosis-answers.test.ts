import type { d1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getDiagnosisAnswers } from "./diagnosis-answers";

const db = {} as d1.Client;
const at = new Date("2026-08-05T00:00:00.000Z");

describe("getDiagnosisAnswers", () => {
  it("本人確認で解決したAccountの回答を取得する", async () => {
    const diagnosis = {
      id: "diagnosis-1",
      title: "タイトル",
      description: "説明",
      responseStatus: "answered" as const,
      answeredCount: 1,
      questionCount: 1,
      scoringConfig: null,
      answers: [],
    };
    const findAnswers = vi.fn().mockResolvedValue({ type: "found", diagnosis });

    const result = await getDiagnosisAnswers(
      { diagnosisId: "diagnosis-1", idToken: "token", lineLoginChannelId: "channel", db, at },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1", role: "user" },
        }),
        findAnswers,
      },
    );

    expect(findAnswers).toHaveBeenCalledWith(db, "account-1", "diagnosis-1", at);
    const { scoringConfig: _, ...expectedDiagnosis } = diagnosis;
    expect(result).toEqual({
      type: "resolved",
      diagnosis: { ...expectedDiagnosis, scoring: null },
    });
  });

  it("回答がない場合はdiagnosis-answers-not-foundへ変換する", async () => {
    const result = await getDiagnosisAnswers(
      { diagnosisId: "diagnosis-1", idToken: "token", lineLoginChannelId: "channel", db, at },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1", role: "user" },
        }),
        findAnswers: vi.fn().mockResolvedValue({ type: "not-found" }),
      },
    );
    expect(result).toEqual({ type: "diagnosis-answers-not-found" });
  });

  it("採点設定が不正でも保存済み回答を返す", async () => {
    const diagnosis = {
      id: "diagnosis-1",
      title: "タイトル",
      description: "説明",
      responseStatus: "in-progress" as const,
      answeredCount: 1,
      questionCount: 2,
      scoringConfig: {
        id: "invalid-config",
        version: 1,
        definition: {},
        questions: [],
      },
      answers: [
        {
          diagnosisQuestionId: "dq-1",
          questionId: "q-1",
          questionVersion: 1,
          questionText: "質問",
          choiceId: "yes",
          choiceLabel: "はい",
          acceptedAt: "2026-08-05T00:00:00.000Z",
        },
      ],
    };

    const result = await getDiagnosisAnswers(
      { diagnosisId: "diagnosis-1", idToken: "token", lineLoginChannelId: "channel", db, at },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1", role: "user" },
        }),
        findAnswers: vi.fn().mockResolvedValue({ type: "found", diagnosis }),
      },
    );

    const { scoringConfig: _, ...expectedDiagnosis } = diagnosis;
    expect(result).toEqual({
      type: "resolved",
      diagnosis: { ...expectedDiagnosis, scoring: null },
    });
  });

  it("本人確認できない場合は回答を取得しない", async () => {
    const findAnswers = vi.fn();
    const session = { type: "unauthenticated" as const, reason: "invalid" };
    const result = await getDiagnosisAnswers(
      { diagnosisId: "diagnosis-1", idToken: undefined, lineLoginChannelId: "channel", db, at },
      { createSession: vi.fn().mockResolvedValue(session), findAnswers },
    );
    expect(result).toEqual(session);
    expect(findAnswers).not.toHaveBeenCalled();
  });
});
