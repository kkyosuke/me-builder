import type { d1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getDiagnosisDetail } from "./diagnosis-detail";

const db = {} as d1.Client;
const at = new Date("2026-08-04T00:00:00.000Z");

describe("getDiagnosisDetail", () => {
  it("本人確認後に指定Diagnosisを取得する", async () => {
    const diagnosis = {
      id: "diagnosis-1",
      title: "タイトル",
      description: "説明",
      opensAt: at.toISOString(),
      closesAt: null,
      questions: [],
    };
    const findOpenDiagnosisDetail = vi.fn().mockResolvedValue({ type: "found", diagnosis });

    const result = await getDiagnosisDetail(
      { diagnosisId: "diagnosis-1", idToken: "token", lineLoginChannelId: "channel", db, at },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1" },
        }),
        findOpenDiagnosisDetail,
      },
    );

    expect(findOpenDiagnosisDetail).toHaveBeenCalledWith(db, "diagnosis-1", at);
    expect(result).toEqual({ type: "resolved", diagnosis });
  });

  it.each([
    ["not-found", "diagnosis-not-found"],
    ["closed", "diagnosis-closed"],
  ] as const)("D1の%sを%sへ変換する", async (resultType, outcomeType) => {
    const result = await getDiagnosisDetail(
      { diagnosisId: "diagnosis-1", idToken: "token", lineLoginChannelId: "channel", db, at },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1" },
        }),
        findOpenDiagnosisDetail: vi.fn().mockResolvedValue({ type: resultType }),
      },
    );
    expect(result).toEqual({ type: outcomeType });
  });

  it("本人確認できない場合はD1から詳細を取得しない", async () => {
    const findOpenDiagnosisDetail = vi.fn();
    const session = { type: "unauthenticated" as const, reason: "invalid" };
    const result = await getDiagnosisDetail(
      { diagnosisId: "diagnosis-1", idToken: undefined, lineLoginChannelId: "channel", db, at },
      { createSession: vi.fn().mockResolvedValue(session), findOpenDiagnosisDetail },
    );
    expect(result).toEqual(session);
    expect(findOpenDiagnosisDetail).not.toHaveBeenCalled();
  });
});
