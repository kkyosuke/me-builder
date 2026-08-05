import type { d1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { resetDevelopmentDiagnosisData } from "./dev-diagnosis-reset";

const db = {} as d1.Client;

describe("resetDevelopmentDiagnosisData", () => {
  it("本人確認で解決したAccountの診断回答データを削除する", async () => {
    const deleted = {
      deletedResponseCount: 2,
      deletedAnswerCount: 12,
      deletedDeferredQuestionCount: 1,
      deletedSourceRecordCount: 12,
    };
    const deleteDiagnosisData = vi.fn().mockResolvedValue(deleted);

    const result = await resetDevelopmentDiagnosisData(
      { idToken: "token", lineLoginChannelId: "channel", db },
      {
        createSession: vi.fn().mockResolvedValue({
          type: "resolved",
          session: { accountId: "account-1" },
        }),
        deleteDiagnosisData,
      },
    );

    expect(deleteDiagnosisData).toHaveBeenCalledWith(db, "account-1");
    expect(result).toEqual({ type: "resolved", ...deleted });
  });

  it("本人確認できない場合は削除しない", async () => {
    const deleteDiagnosisData = vi.fn();
    const session = { type: "unauthenticated" as const, reason: "invalid" };

    const result = await resetDevelopmentDiagnosisData(
      { idToken: undefined, lineLoginChannelId: "channel", db },
      { createSession: vi.fn().mockResolvedValue(session), deleteDiagnosisData },
    );

    expect(result).toEqual(session);
    expect(deleteDiagnosisData).not.toHaveBeenCalled();
  });
});
