import {
  type AccountDataNamespace,
  type AccountDataResult,
  type CompatibilityDataNamespace,
  type ConversationCoordinatorNamespace,
  D1,
  accountDataFor,
  type billing,
  cancelCompatibilityInvitationWithReference,
  conversationCoordinatorFor,
  endCompatibilityRelationshipWithReferences,
} from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";

type SharedDb = ReturnType<typeof D1.shared.client.create>;

export type DeleteOwnAccountOutcome = Readonly<{
  type: "deleted";
  scheduledVectorDeletionCount: number;
}>;

type Params = Readonly<{
  actor: AuthenticatedActor;
  db: SharedDb;
  accountData: AccountDataNamespace;
  compatibilityData: CompatibilityDataNamespace;
  conversationCoordinator: ConversationCoordinatorNamespace;
  billingProvider?: billing.BillingProvider;
  deleteAvatarObject: (objectKey: string) => Promise<void>;
  now?: Date;
}>;

type Dependencies = Readonly<{
  findBillingCustomer: typeof D1.shared.action.billing.findBillingCustomerByAccount;
  listCompatibilityReferences: (
    namespace: AccountDataNamespace,
    accountId: string,
  ) => Promise<AccountDataResult<"compatibility.listVisibleReferences">>;
  cancelCompatibility: typeof cancelCompatibilityInvitationWithReference;
  endCompatibility: typeof endCompatibilityRelationshipWithReferences;
  leaveFamily: typeof D1.shared.action.familySeat.leaveFamilySeat;
  endFamily: typeof D1.shared.action.familySeat.endFamilyPack;
  getAvatar: typeof D1.shared.action.profile.getProfileAvatar;
  resetCoordinator: (
    namespace: ConversationCoordinatorNamespace,
    accountId: string,
  ) => Promise<number>;
  deleteAccountData: (
    namespace: AccountDataNamespace,
    accountId: string,
    resetEpoch: number,
    at: Date,
  ) => Promise<AccountDataResult<"account.deleteAllData">>;
  deleteAccount: typeof D1.shared.action.account.deleteAccount;
}>;

const defaultDependencies: Dependencies = {
  findBillingCustomer: D1.shared.action.billing.findBillingCustomerByAccount,
  listCompatibilityReferences: (namespace, accountId) =>
    accountDataFor(namespace, accountId).execute("compatibility.listVisibleReferences"),
  cancelCompatibility: cancelCompatibilityInvitationWithReference,
  endCompatibility: endCompatibilityRelationshipWithReferences,
  leaveFamily: D1.shared.action.familySeat.leaveFamilySeat,
  endFamily: D1.shared.action.familySeat.endFamilyPack,
  getAvatar: D1.shared.action.profile.getProfileAvatar,
  resetCoordinator: (namespace, accountId) =>
    conversationCoordinatorFor(namespace, accountId).resetAccountData(accountId),
  deleteAccountData: (namespace, accountId, resetEpoch, at) =>
    accountDataFor(namespace, accountId).execute("account.deleteAllData", resetEpoch, at),
  deleteAccount: D1.shared.action.account.deleteAccount,
};

/**
 * 外部課金と共有関係を先に閉じ、本人コンテンツ、外部画像、ログイン情報の順で削除する。
 * 途中失敗時は再実行でき、Accountのログイン情報を消すのは全依存処理の成功後に限る。
 */
export async function deleteOwnAccount(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<DeleteOwnAccountOutcome> {
  const accountId = params.actor.accountId;
  const now = params.now ?? new Date();
  const customer = await dependencies.findBillingCustomer(params.db, accountId);
  if (customer) {
    if (!params.billingProvider)
      throw new Error("Billing provider is required for Account deletion");
    const remote = await params.billingProvider.retrieveCustomer(customer.providerCustomerId);
    if (!remote.deleted) {
      const deleted = await params.billingProvider.deleteCustomer(
        customer.providerCustomerId,
        `account-delete:${accountId}`,
      );
      if (!deleted.deleted) throw new Error("Billing customer deletion was not confirmed");
    }
  }

  const references = await dependencies.listCompatibilityReferences(params.accountData, accountId);
  for (const reference of references) {
    if (reference.status === "pending") {
      const cancelled = await dependencies.cancelCompatibility(
        params.accountData,
        params.compatibilityData,
        reference.relationshipId,
        accountId,
      );
      if (cancelled.outcome === "forbidden") {
        throw new Error("Account does not own its pending compatibility reference");
      }
      if (cancelled.outcome === "unavailable") {
        // 承諾との競合なら、現在の正本を関係終了として再収束させる。
        await dependencies.endCompatibility(
          params.accountData,
          params.compatibilityData,
          reference.relationshipId,
          accountId,
        );
      }
    } else if (reference.status === "active") {
      await dependencies.endCompatibility(
        params.accountData,
        params.compatibilityData,
        reference.relationshipId,
        accountId,
      );
    }
  }

  await dependencies.leaveFamily(params.db, accountId, now);
  await dependencies.endFamily(params.db, accountId, now);
  const avatar = await dependencies.getAvatar(params.db, accountId);
  const resetEpoch = await dependencies.resetCoordinator(params.conversationCoordinator, accountId);
  const deletedContent = await dependencies.deleteAccountData(
    params.accountData,
    accountId,
    resetEpoch,
    now,
  );
  if (avatar) await params.deleteAvatarObject(avatar.objectKey);
  const deletedAccount = await dependencies.deleteAccount(params.db, accountId, now);
  if (!deletedAccount.deleted) throw new Error("Account deletion did not update an active Account");

  return {
    type: "deleted",
    scheduledVectorDeletionCount: deletedContent.scheduledVectorDeletionCount,
  };
}
