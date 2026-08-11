import { type AccountDataNamespace, type D1, type DO, accountDataFor } from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

type DevelopmentBrainItems = Awaited<
  ReturnType<typeof DO.account.action.brain.listActiveBrainItems>
>;

export type DevelopmentBrainItemsOutcome =
  | ({ type: "resolved" } & DevelopmentBrainItems)
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData?: AccountDataNamespace;
};

type Dependencies = {
  createSession: typeof createLiffSession;
  listActive: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
  ) => Promise<DevelopmentBrainItems>;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  listActive: (accountData, accountId) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("brain.listActive");
  },
};

/** 本人確認済みAccountのactive Brain Itemを開発用確認画面へ返す。 */
export async function getDevelopmentBrainItems(
  { idToken, lineLoginChannelId, db, accountData }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<DevelopmentBrainItemsOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;

  const result = await dependencies.listActive(accountData, session.session.accountId);
  return { type: "resolved", ...result };
}
