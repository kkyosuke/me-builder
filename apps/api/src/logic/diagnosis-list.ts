import { type AccountDataNamespace, accountDataFor, type d1 } from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

export type DiagnosisListOutcome =
  | {
      type: "resolved";
      diagnoses: Awaited<ReturnType<typeof d1.action.diagnosis.listVisibleDiagnoses>>;
    }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type DiagnosisListParams = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: d1.Client;
  accountData?: AccountDataNamespace;
  at?: Date;
};

type DiagnosisListDependencies = {
  createSession: typeof createLiffSession;
  listVisibleDiagnoses: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    at: Date,
  ) => ReturnType<typeof d1.action.diagnosis.listVisibleDiagnoses>;
};

const defaultDependencies: DiagnosisListDependencies = {
  createSession: createLiffSession,
  listVisibleDiagnoses: (accountData, accountId, at) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("diagnosis.listVisible", at);
  },
};

/**
 * LIFF の本人確認結果から Account を解決し、その Account の回答進捗を含む一覧を返します。
 * HTTP の認証ヘッダーやステータスコードは controller 側の責務です。
 */
export async function getDiagnosisList(
  { idToken, lineLoginChannelId, db, accountData, at = new Date() }: DiagnosisListParams,
  dependencies: DiagnosisListDependencies = defaultDependencies,
): Promise<DiagnosisListOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });

  if (session.type !== "resolved") {
    return session;
  }

  const diagnoses = await dependencies.listVisibleDiagnoses(
    accountData,
    session.session.accountId,
    at,
  );
  return { type: "resolved", diagnoses };
}
