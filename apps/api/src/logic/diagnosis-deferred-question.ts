import { type AccountDataNamespace, accountDataFor, type d1 } from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

type Deferred = Extract<
  Awaited<ReturnType<typeof d1.action.diagnosis.deferDiagnosisQuestion>>,
  { type: "deferred" }
>;

export type DeferDiagnosisQuestionOutcome =
  | Deferred
  | { type: "diagnosis-not-found" }
  | { type: "diagnosis-closed" }
  | { type: "diagnosis-question-not-found" }
  | { type: "question-already-answered" }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = {
  diagnosisId: string;
  diagnosisQuestionId: string;
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: d1.Client;
  accountData?: AccountDataNamespace;
  at?: Date;
};

type Dependencies = {
  createSession: typeof createLiffSession;
  deferQuestion: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    input: Parameters<typeof d1.action.diagnosis.deferDiagnosisQuestion>[1],
  ) => ReturnType<typeof d1.action.diagnosis.deferDiagnosisQuestion>;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  deferQuestion: (accountData, accountId, input) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("diagnosis.deferQuestion", input);
  },
};

/** 本人確認結果からAccountを解決し、その本人の延期操作だけを保存します。 */
export async function deferDiagnosisQuestion(
  {
    diagnosisId,
    diagnosisQuestionId,
    idToken,
    lineLoginChannelId,
    db,
    accountData,
    at = new Date(),
  }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<DeferDiagnosisQuestionOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") {
    return session;
  }
  return dependencies.deferQuestion(accountData, session.session.accountId, {
    accountId: session.session.accountId,
    diagnosisId,
    diagnosisQuestionId,
    at,
  });
}
