import type { AccountDataNamespace, ConversationCoordinatorNamespace } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { resetDevelopmentAccountData } from "./dev-account-data-reset";

const accountData = {} as AccountDataNamespace;
const conversationCoordinator = {} as ConversationCoordinatorNamespace;
const actor = {
  accountId: "account-1",
  authenticationMethod: "liff" as const,
  authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
};

describe("resetDevelopmentAccountData", () => {
  it("本人解決後にCoordinatorを止めてからAccountDataを削除する", async () => {
    const order: string[] = [];
    const deleted = {
      deletedDiagnosisResponseCount: 1,
      deletedConversationSessionCount: 2,
      deletedSourceRecordCount: 3,
      deletedBrainItemCount: 4,
      deletedProfileSummaryVersionCount: 5,
      scheduledVectorDeletionCount: 6,
    };
    const resetCoordinator = vi.fn(async () => {
      order.push("coordinator");
      return 7;
    });
    const deleteAccountData = vi.fn(async () => {
      order.push("account-data");
      return deleted;
    });

    await expect(
      resetDevelopmentAccountData(
        {
          actor,
          accountData,
          conversationCoordinator,
        },
        {
          resetCoordinator,
          deleteAccountData,
        },
      ),
    ).resolves.toEqual({ type: "resolved", ...deleted });
    expect(order).toEqual(["coordinator", "account-data"]);
    expect(resetCoordinator).toHaveBeenCalledWith(conversationCoordinator, "account-1");
    expect(deleteAccountData).toHaveBeenCalledWith(accountData, "account-1", 7);
  });
});
