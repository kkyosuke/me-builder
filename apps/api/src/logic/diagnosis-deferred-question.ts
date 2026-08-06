import { d1 } from "@me-builder/lib";
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
  at?: Date;
};

type Dependencies = {
  createSession: typeof createLiffSession;
  deferQuestion: typeof d1.action.diagnosis.deferDiagnosisQuestion;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  deferQuestion: d1.action.diagnosis.deferDiagnosisQuestion,
};

/** 本人確認結果からAccountを解決し、その本人の延期操作だけを保存します。 */
export async function deferDiagnosisQuestion(
  { diagnosisId, diagnosisQuestionId, idToken, lineLoginChannelId, db, at = new Date() }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<DeferDiagnosisQuestionOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") {
    return session;
  }
  return dependencies.deferQuestion(db, {
    accountId: session.session.accountId,
    diagnosisId,
    diagnosisQuestionId,
    at,
  });
}
