import { type AccountDataNamespace, accountDataFor, type d1 } from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

type DeletedDiagnosisData = Awaited<
  ReturnType<typeof d1.action.diagnosis.deleteAccountDiagnosisData>
>;

export type ResetDevelopmentDiagnosisDataOutcome =
  | ({ type: "resolved" } & DeletedDiagnosisData)
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: d1.Client;
  accountData?: AccountDataNamespace;
};

type Dependencies = {
  createSession: typeof createLiffSession;
  deleteDiagnosisData: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
  ) => ReturnType<typeof d1.action.diagnosis.deleteAccountDiagnosisData>;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  deleteDiagnosisData: (accountData, accountId) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("diagnosis.deleteAccountData");
  },
};

/** 本人確認後に、本人の診断回答由来データを開発用に物理削除します。 */
export async function resetDevelopmentDiagnosisData(
  { idToken, lineLoginChannelId, db, accountData }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<ResetDevelopmentDiagnosisDataOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") {
    return session;
  }

  const deleted = await dependencies.deleteDiagnosisData(accountData, session.session.accountId);
  return { type: "resolved", ...deleted };
}
