import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, OperationError, UnknownError } from "../../../infrastructure/errors";
import { resetDevelopmentAccountData } from "./development-account-data-api";

const API_URL = "https://api.stg.kagami.kyosuke.dev";

describe("resetDevelopmentAccountData", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Bearerトークンを付けてDELETEし、削除件数を返す", async () => {
    const deleted = {
      deletedDiagnosisResponseCount: 2,
      deletedConversationSessionCount: 3,
      deletedSourceRecordCount: 12,
      deletedBrainItemCount: 4,
      deletedProfileSummaryVersionCount: 1,
      scheduledVectorDeletionCount: 5,
    };
    const fetchMock = vi.fn(async () => Response.json(deleted));
    vi.stubGlobal("fetch", fetchMock);
    await expect(resetDevelopmentAccountData(API_URL, "dummy.id.token")).resolves.toEqual(deleted);
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/dev/account-data`, {
      method: "DELETE",
      headers: { Authorization: "Bearer dummy.id.token" },
    });
  });

  it.each([
    [401, AuthenticationError, "AUTHENTICATION_REQUIRED"],
    [404, OperationError, "DEVELOPMENT_RESET_UNAVAILABLE"],
    [500, UnknownError, "DEVELOPMENT_RESET_REQUEST_FAILED"],
  ] as const)("HTTP %sをcode %sへ変換する", async (status, ErrorType, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status })),
    );
    try {
      await resetDevelopmentAccountData(API_URL, "token");
      throw new Error("本人データ削除が成功してしまいました");
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorType);
      expect(error).toMatchObject({ code, status });
    }
  });
});
