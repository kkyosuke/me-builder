import {
  type AccountDataNamespace,
  type ConversationCoordinatorNamespace,
  type D1,
  type DO,
  accountDataFor,
  conversationCoordinatorFor,
} from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

type DeletedAccountData = Awaited<
  ReturnType<typeof DO.account.action.development.deleteAllDevelopmentAccountData>
>;

export type ResetDevelopmentAccountDataOutcome =
  | ({ type: "resolved" } & DeletedAccountData)
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData: AccountDataNamespace;
  conversationCoordinator: ConversationCoordinatorNamespace;
};

type Dependencies = {
  createSession: typeof createLiffSession;
  resetCoordinator: (
    namespace: ConversationCoordinatorNamespace,
    accountId: string,
  ) => Promise<void>;
  deleteAccountData: (
    namespace: AccountDataNamespace,
    accountId: string,
  ) => ReturnType<typeof DO.account.action.development.deleteAllDevelopmentAccountData>;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  resetCoordinator: (namespace, accountId) =>
    conversationCoordinatorFor(namespace, accountId).resetAccountData(accountId),
  deleteAccountData: (namespace, accountId) =>
    accountDataFor(namespace, accountId).execute("development.deleteAllAccountData"),
};

/** 本人確認後に、進行中の日記処理を止めてAccountData個人コンテンツを物理削除する。 */
export async function resetDevelopmentAccountData(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<ResetDevelopmentAccountDataOutcome> {
  const session = await dependencies.createSession({
    idToken: params.idToken,
    lineLoginChannelId: params.lineLoginChannelId,
    db: params.db,
  });
  if (session.type !== "resolved") return session;

  const accountId = session.session.accountId;
  await dependencies.resetCoordinator(params.conversationCoordinator, accountId);
  const deleted = await dependencies.deleteAccountData(params.accountData, accountId);
  return { type: "resolved", ...deleted };
}
