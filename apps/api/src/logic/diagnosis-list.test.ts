import { describe, expect, it, vi } from "vitest";
import { getDiagnosisList } from "./diagnosis-list";

const at = new Date("2026-08-04T00:00:00.000Z");
const actor = {
  accountId: "account-1",
  authenticationMethod: "liff" as const,
  authenticatedAt: at,
};

describe("getDiagnosisList", () => {
  it("検証済みAccountのIDだけを使って一覧を取得すること", async () => {
    const diagnoses = [
      {
        id: "diagnosis-1",
        title: "タイトル",
        description: "説明",
        opensAt: "2026-08-01T00:00:00.000Z",
        closesAt: null,
        availability: "open" as const,
        responseStatus: "unanswered" as const,
        answeredCount: 0,
        questionCount: 3,
      },
    ];
    const listVisibleDiagnoses = vi.fn().mockResolvedValue(diagnoses);

    const result = await getDiagnosisList({ actor, at }, { listVisibleDiagnoses });

    expect(listVisibleDiagnoses).toHaveBeenCalledWith(undefined, "account-1", at);
    expect(result).toEqual({ type: "resolved", diagnoses });
  });
});
