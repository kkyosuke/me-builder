import { billing } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { deleteOwnAccount } from "./account-deletion";

const actor = {
  accountId: "account-delete",
  authenticationMethod: "liff" as const,
  authenticatedAt: new Date("2026-08-21T00:00:00.000Z"),
};

function dependencies(order: string[]) {
  return {
    findBillingCustomer: vi.fn(async () => ({ providerCustomerId: "cus_delete" }) as never),
    listCompatibilityReferences: vi.fn(
      async () =>
        [
          { relationshipId: "pending", status: "pending" },
          { relationshipId: "active", status: "active" },
        ] as never,
    ),
    listPhotoObjectKeys: vi.fn(async () => ["photo/original", "photo/thumbnail"] as never),
    cancelCompatibility: vi.fn(async () => {
      order.push("cancel-compatibility");
      return { outcome: "cancelled" } as never;
    }),
    endCompatibility: vi.fn(async () => {
      order.push("end-compatibility");
      return {} as never;
    }),
    leaveFamily: vi.fn(async () => {
      order.push("leave-family");
      return {} as never;
    }),
    endFamily: vi.fn(async () => {
      order.push("end-family");
      return null;
    }),
    getAvatar: vi.fn(async () => ({ objectKey: "accounts/account-delete/avatar" }) as never),
    resetCoordinator: vi.fn(async () => {
      order.push("reset-coordinator");
      return 2;
    }),
    deleteAccountData: vi.fn(async () => {
      order.push("delete-content");
      return { scheduledVectorDeletionCount: 3 } as never;
    }),
    deleteAccount: vi.fn(async () => {
      order.push("delete-identity");
      return { deleted: true, avatarObjectKey: "accounts/account-delete/avatar" };
    }),
  };
}

describe("deleteOwnAccount", () => {
  it("課金と共有関係を閉じてから本人コンテンツとidentityを削除する", async () => {
    const order: string[] = [];
    const provider = new billing.FakeBillingProvider({
      retrieveCustomer: async (customerId) => ({ id: customerId, deleted: false }),
      deleteCustomer: async (customerId, key) => {
        order.push(`delete-customer:${key}`);
        return { id: customerId, deleted: true };
      },
    });
    const deps = dependencies(order);

    await expect(
      deleteOwnAccount(
        {
          actor,
          db: {} as never,
          accountData: {} as never,
          compatibilityData: {} as never,
          conversationCoordinator: {} as never,
          billingProvider: provider,
          deleteAvatarObject: async () => {
            order.push("delete-avatar");
          },
          deletePhotoObjects: async () => {
            order.push("delete-photos");
          },
          now: new Date("2026-08-21T00:01:00.000Z"),
        },
        deps,
      ),
    ).resolves.toEqual({ type: "deleted", scheduledVectorDeletionCount: 3 });

    expect(order).toEqual([
      "delete-customer:account-delete:account-delete",
      "cancel-compatibility",
      "end-compatibility",
      "leave-family",
      "end-family",
      "reset-coordinator",
      "delete-photos",
      "delete-content",
      "delete-avatar",
      "delete-identity",
    ]);
  });

  it("課金providerがない場合はAccountを残して失敗する", async () => {
    const order: string[] = [];
    const deps = dependencies(order);
    await expect(
      deleteOwnAccount(
        {
          actor,
          db: {} as never,
          accountData: {} as never,
          compatibilityData: {} as never,
          conversationCoordinator: {} as never,
          deleteAvatarObject: async () => undefined,
          deletePhotoObjects: async () => undefined,
        },
        deps,
      ),
    ).rejects.toThrow("Billing provider is required");
    expect(order).toEqual([]);
    expect(deps.deleteAccount).not.toHaveBeenCalled();
  });
});
