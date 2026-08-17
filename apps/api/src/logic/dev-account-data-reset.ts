import {
  type AccountDataNamespace,
  type ConversationCoordinatorNamespace,
  type DO,
  accountDataFor,
  conversationCoordinatorFor,
} from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";

type DeletedAccountData = Awaited<
  ReturnType<typeof DO.account.action.development.deleteAllDevelopmentAccountData>
>;

export type ResetDevelopmentAccountDataOutcome = { type: "resolved" } & DeletedAccountData;

type Params = {
  actor: AuthenticatedActor;
  accountData: AccountDataNamespace;
  conversationCoordinator: ConversationCoordinatorNamespace;
};

type Dependencies = {
  resetCoordinator: (
    namespace: ConversationCoordinatorNamespace,
    accountId: string,
  ) => Promise<number>;
  deleteAccountData: (
    namespace: AccountDataNamespace,
    accountId: string,
    resetEpoch: number,
  ) => ReturnType<typeof DO.account.action.development.deleteAllDevelopmentAccountData>;
};

const defaultDependencies: Dependencies = {
  resetCoordinator: (namespace, accountId) =>
    conversationCoordinatorFor(namespace, accountId).resetAccountData(accountId),
  deleteAccountData: (namespace, accountId, resetEpoch) =>
    accountDataFor(namespace, accountId).execute("development.deleteAllAccountData", resetEpoch),
};

/** 本人確認後に、進行中の日記処理を止めてAccountData個人コンテンツを物理削除する。 */
export async function resetDevelopmentAccountData(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<ResetDevelopmentAccountDataOutcome> {
  const accountId = params.actor.accountId;
  const resetEpoch = await dependencies.resetCoordinator(params.conversationCoordinator, accountId);
  const deleted = await dependencies.deleteAccountData(params.accountData, accountId, resetEpoch);
  return { type: "resolved", ...deleted };
}
