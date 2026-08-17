import type { D1Database } from "@cloudflare/workers-types";
import type { AccountDataNamespace, ConversationCoordinatorNamespace } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import type { ResetDevelopmentAccountDataOutcome } from "../logic/dev-account-data-reset";

const { resetDevelopmentAccountData } = vi.hoisted(() => ({
  resetDevelopmentAccountData: vi.fn(),
}));
vi.mock("../logic/dev-account-data-reset", () => ({ resetDevelopmentAccountData }));
vi.mock("../middleware/authentication", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/authentication")>();
  return {
    ...actual,
    requireAuthentication: async (
      c: Parameters<typeof actual.requireAuthentication>[0],
      next: () => Promise<void>,
    ) => {
      c.set("authenticatedActor", {
        accountId: "account-1",
        authenticationMethod: "liff",
        authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
      });
      await next();
    },
  };
});
vi.mock("../middleware/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/authorization")>();
  return {
    ...actual,
    requireCurrentTerms: async (_c: unknown, next: () => Promise<void>) => next(),
  };
});

const dummyDb = {} as D1Database;
const dummyAccountData = {} as AccountDataNamespace;
const dummyCoordinator = {} as ConversationCoordinatorNamespace;
const LIFF_ID = "2010850319-Yl63upAR";
const resetOutcome = (value: ResetDevelopmentAccountDataOutcome) =>
  resetDevelopmentAccountData.mockResolvedValue(value);

describe("DELETE /api/dev/account-data", () => {
  beforeEach(() => vi.clearAllMocks());

  const remove = (environment: string | undefined, withBindings = true) =>
    app.request(
      "/api/dev/account-data",
      { method: "DELETE", headers: { Authorization: "Bearer dummy.id.token" } },
      {
        LIFF_ID,
        ...(environment === undefined ? {} : { ENVIRONMENT: environment }),
        ...(withBindings
          ? {
              DB: dummyDb,
              ACCOUNT_DATA: dummyAccountData,
              CONVERSATION_COORDINATOR: dummyCoordinator,
            }
          : {}),
      },
    );

  it("previewでは削除件数を200で返す", async () => {
    const deleted = {
      type: "resolved",
      deletedDiagnosisResponseCount: 2,
      deletedConversationSessionCount: 3,
      deletedSourceRecordCount: 12,
      deletedBrainItemCount: 4,
      deletedProfileSummaryVersionCount: 1,
      scheduledVectorDeletionCount: 5,
    } as const;
    resetOutcome(deleted);
    const response = await remove("preview");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      deletedDiagnosisResponseCount: 2,
      deletedConversationSessionCount: 3,
      deletedSourceRecordCount: 12,
      deletedBrainItemCount: 4,
      deletedProfileSummaryVersionCount: 1,
      scheduledVectorDeletionCount: 5,
    });
    expect(resetDevelopmentAccountData).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ accountId: "account-1" }),
        accountData: dummyAccountData,
        conversationCoordinator: dummyCoordinator,
      }),
    );
  });

  it.each(["production", "staging"])("%sでは404で削除しない", async (environment) => {
    const response = await remove(environment);
    expect(response.status).toBe(404);
    expect(resetDevelopmentAccountData).not.toHaveBeenCalled();
  });

  it.each([undefined, ""])("ENVIRONMENTが%sなら404で削除しない", async (environment) => {
    const response = await remove(environment);
    expect(response.status).toBe(404);
    expect(resetDevelopmentAccountData).not.toHaveBeenCalled();
  });

  it("開発環境でもbinding不足なら503を返す", async () => {
    const response = await remove("preview", false);
    expect(response.status).toBe(503);
    expect(resetDevelopmentAccountData).not.toHaveBeenCalled();
  });
});
