import type { AccountDataNamespace, ConversationCoordinatorNamespace, D1 } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { resetDevelopmentAccountData } from "./dev-account-data-reset";

const db = {} as D1.shared.Client;
const accountData = {} as AccountDataNamespace;
const conversationCoordinator = {} as ConversationCoordinatorNamespace;
const session = { type: "resolved", session: { accountId: "account-1" } } as const;

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
    });
    const deleteAccountData = vi.fn(async () => {
      order.push("account-data");
      return deleted;
    });

    await expect(
      resetDevelopmentAccountData(
        {
          idToken: "token",
          lineLoginChannelId: "channel",
          db,
          accountData,
          conversationCoordinator,
        },
        {
          createSession: vi.fn().mockResolvedValue(session),
          resetCoordinator,
          deleteAccountData,
        },
      ),
    ).resolves.toEqual({ type: "resolved", ...deleted });
    expect(order).toEqual(["coordinator", "account-data"]);
    expect(resetCoordinator).toHaveBeenCalledWith(conversationCoordinator, "account-1");
    expect(deleteAccountData).toHaveBeenCalledWith(accountData, "account-1");
  });

  it("本人を解決できなければ保存先を操作しない", async () => {
    const resetCoordinator = vi.fn();
    const deleteAccountData = vi.fn();
    await expect(
      resetDevelopmentAccountData(
        {
          idToken: undefined,
          lineLoginChannelId: "channel",
          db,
          accountData,
          conversationCoordinator,
        },
        {
          createSession: vi.fn().mockResolvedValue({ type: "unauthenticated", reason: "missing" }),
          resetCoordinator,
          deleteAccountData,
        },
      ),
    ).resolves.toEqual({ type: "unauthenticated", reason: "missing" });
    expect(resetCoordinator).not.toHaveBeenCalled();
    expect(deleteAccountData).not.toHaveBeenCalled();
  });
});
