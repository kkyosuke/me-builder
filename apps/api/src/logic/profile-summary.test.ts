import type { AccountDataNamespace, D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { getProfileSummary } from "./profile-summary";

const db = {} as D1.shared.Client;
const accountData = {} as AccountDataNamespace;
const readModel = {
  versions: [
    {
      id: "version-1",
      sequence: 1,
      generatedAt: "2026-08-08T12:00:00.000Z",
      isLatest: true,
      generationMethod: "ai",
      summary: {
        generatedAt: "2026-08-08T12:00:00.000Z",
        headline: "まとめ",
        insights: [],
        recordCount: 0,
        diagnosisCount: 0,
        diaryCount: 0,
        latestRecordedAt: null,
      },
    },
  ],
  availableDataCounts: { diagnosis: 2, diary: 4 },
  generation: { status: "idle", canRegenerate: false, reasons: [], message: null },
} as const;

function dependencies(diagnoses: unknown[]) {
  return {
    createSession: vi.fn().mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-1", role: "user" },
    }),
    listVisibleDiagnoses: vi.fn().mockResolvedValue(diagnoses),
    readProfileSummary: vi.fn().mockResolvedValue(readModel),
  };
}

describe("getProfileSummary", () => {
  it("受付中の未回答診断があれば診断を次の行動にする", async () => {
    const deps = dependencies([{ availability: "open", responseStatus: "unanswered" }]);

    const result = await getProfileSummary(
      { idToken: "token", lineLoginChannelId: "channel", db, accountData },
      deps as never,
    );

    expect(result).toMatchObject({ type: "resolved", nextAction: "diagnosis" });
    expect(deps.listVisibleDiagnoses).toHaveBeenCalledWith(
      accountData,
      "account-1",
      expect.any(Date),
    );
    expect(deps.readProfileSummary).toHaveBeenCalledWith(
      accountData,
      "account-1",
      expect.any(Date),
      false,
    );
  });

  it("開発環境の無変更再生成許可をAccountDataへ渡す", async () => {
    const deps = dependencies([]);

    await getProfileSummary(
      {
        idToken: "token",
        lineLoginChannelId: "channel",
        db,
        accountData,
        allowUnchangedRegeneration: true,
      },
      deps as never,
    );

    expect(deps.readProfileSummary).toHaveBeenCalledWith(
      accountData,
      "account-1",
      expect.any(Date),
      true,
    );
  });

  it("回答できる診断がなければチャットを次の行動にする", async () => {
    const deps = dependencies([
      { availability: "open", responseStatus: "answered" },
      { availability: "closed", responseStatus: "in-progress" },
    ]);

    const result = await getProfileSummary(
      { idToken: "token", lineLoginChannelId: "channel", db, accountData },
      deps as never,
    );

    expect(result).toMatchObject({ type: "resolved", nextAction: "chat" });
  });

  it("保存済み版がなければAccountDataの空の読み取り結果を返す", async () => {
    const deps = dependencies([{ availability: "open", responseStatus: "unanswered" }]);
    deps.readProfileSummary.mockResolvedValue({
      versions: [],
      availableDataCounts: { diagnosis: 0, diary: 0 },
      generation: { status: "idle", canRegenerate: false, reasons: [], message: null },
    });

    const result = await getProfileSummary(
      { idToken: "token", lineLoginChannelId: "channel", db, accountData },
      deps as never,
    );

    expect(result).toMatchObject({
      type: "resolved",
      versions: [],
      availableDataCounts: { diagnosis: 0, diary: 0 },
      generation: { status: "idle", canRegenerate: false, reasons: [], message: null },
    });
  });

  it("AccountDataの保存済み版、現在件数、生成状態を返す", async () => {
    const deps = dependencies([]);

    const result = await getProfileSummary(
      { idToken: "token", lineLoginChannelId: "channel", db, accountData },
      deps as never,
    );

    expect(result).toMatchObject({
      type: "resolved",
      versions: [{ id: "version-1", isLatest: true }],
      availableDataCounts: { diagnosis: 2, diary: 4 },
      generation: { status: "idle", canRegenerate: false, reasons: [], message: null },
    });
  });

  it("本人を解決できなければ診断進捗を取得しない", async () => {
    const deps = dependencies([]);
    deps.createSession.mockResolvedValue({ type: "unauthenticated", reason: "invalid" } as never);

    const result = await getProfileSummary(
      { idToken: undefined, lineLoginChannelId: "channel", db, accountData },
      deps as never,
    );

    expect(result).toEqual({ type: "unauthenticated", reason: "invalid" });
    expect(deps.listVisibleDiagnoses).not.toHaveBeenCalled();
    expect(deps.readProfileSummary).not.toHaveBeenCalled();
  });
});
