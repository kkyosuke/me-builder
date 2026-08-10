import type { D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getDiagnosisList } from "./diagnosis-list";

const db = {} as D1.shared.Client;
const at = new Date("2026-08-04T00:00:00.000Z");

describe("getDiagnosisList", () => {
  it("検証済みAccountのIDだけを使って一覧を取得すること", async () => {
    const createSession = vi.fn().mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-1", role: "user" },
    });
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

    const result = await getDiagnosisList(
      { idToken: "id-token", lineLoginChannelId: "channel-id", db, at },
      { createSession, listVisibleDiagnoses },
    );

    expect(listVisibleDiagnoses).toHaveBeenCalledWith(undefined, "account-1", at);
    expect(result).toEqual({ type: "resolved", diagnoses });
  });

  it.each([
    { type: "not-configured" as const },
    { type: "unauthenticated" as const, reason: "invalid token" },
    { type: "account-not-found" as const },
  ])("セッションを解決できない場合は一覧を取得しないこと: $type", async (session) => {
    const listVisibleDiagnoses = vi.fn();

    const result = await getDiagnosisList(
      { idToken: undefined, lineLoginChannelId: undefined, db, at },
      {
        createSession: vi.fn().mockResolvedValue(session),
        listVisibleDiagnoses,
      },
    );

    expect(result).toEqual(session);
    expect(listVisibleDiagnoses).not.toHaveBeenCalled();
  });
});
