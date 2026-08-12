import type { D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getDiagnosisDetail } from "./diagnosis-detail";

const db = {} as D1.shared.Client;
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
    const hasDiagnosisResponse = vi.fn();

    const result = await getDiagnosisDetail(
      { diagnosisId: "diagnosis-1", idToken: "token", lineLoginChannelId: "channel", db, at },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1", role: "user" },
        }),
        findOpenDiagnosisDetail,
        hasDiagnosisResponse,
      },
    );

    expect(findOpenDiagnosisDetail).toHaveBeenCalledWith(db, "diagnosis-1", at);
    expect(hasDiagnosisResponse).not.toHaveBeenCalled();
    expect(result).toEqual({ type: "resolved", diagnosis });
  });

  it.each([["closed", "diagnosis-closed"]] as const)(
    "D1の%sを%sへ変換する",
    async (resultType, outcomeType) => {
      const result = await getDiagnosisDetail(
        { diagnosisId: "diagnosis-1", idToken: "token", lineLoginChannelId: "channel", db, at },
        {
          createSession: vi.fn().mockResolvedValue({
            type: "resolved",
            session: { accountId: "account-1", role: "user" },
          }),
          findOpenDiagnosisDetail: vi.fn().mockResolvedValue({ type: resultType }),
          hasDiagnosisResponse: vi.fn(),
        },
      );
      expect(result).toEqual({ type: outcomeType });
    },
  );

  it("withdrawnは本人にResponseがある場合だけ詳細を返す", async () => {
    const diagnosis = {
      id: "diagnosis-1",
      title: "タイトル",
      description: "説明",
      opensAt: at.toISOString(),
      closesAt: null,
      questions: [],
    };
    const findOpenDiagnosisDetail = vi
      .fn()
      .mockResolvedValueOnce({ type: "not-found" })
      .mockResolvedValueOnce({ type: "found", diagnosis });
    const hasDiagnosisResponse = vi.fn().mockResolvedValue(true);

    const result = await getDiagnosisDetail(
      { diagnosisId: "diagnosis-1", idToken: "token", lineLoginChannelId: "channel", db, at },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1", role: "user" },
        }),
        findOpenDiagnosisDetail,
        hasDiagnosisResponse,
      },
    );

    expect(hasDiagnosisResponse).toHaveBeenCalledWith(undefined, "account-1", "diagnosis-1");
    expect(findOpenDiagnosisDetail).toHaveBeenLastCalledWith(db, "diagnosis-1", at, {
      allowWithdrawn: true,
    });
    expect(result).toEqual({ type: "resolved", diagnosis });
  });

  it("非公開Diagnosisに本人のResponseがなければnot-foundを返す", async () => {
    const result = await getDiagnosisDetail(
      { diagnosisId: "diagnosis-1", idToken: "token", lineLoginChannelId: "channel", db, at },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1", role: "user" },
        }),
        findOpenDiagnosisDetail: vi.fn().mockResolvedValue({ type: "not-found" }),
        hasDiagnosisResponse: vi.fn().mockResolvedValue(false),
      },
    );

    expect(result).toEqual({ type: "diagnosis-not-found" });
  });

  it("本人確認できない場合はD1から詳細を取得しない", async () => {
    const findOpenDiagnosisDetail = vi.fn();
    const session = { type: "unauthenticated" as const, reason: "invalid" };
    const result = await getDiagnosisDetail(
      { diagnosisId: "diagnosis-1", idToken: undefined, lineLoginChannelId: "channel", db, at },
      {
        createSession: vi.fn().mockResolvedValue(session),
        findOpenDiagnosisDetail,
        hasDiagnosisResponse: vi.fn(),
      },
    );
    expect(result).toEqual(session);
    expect(findOpenDiagnosisDetail).not.toHaveBeenCalled();
  });
});
