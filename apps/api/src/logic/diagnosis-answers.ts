import { d1 } from "@me-builder/lib";
import { scoreDiagnosisAnswers } from "./diagnosis-scoring";
import { createLiffSession } from "./liff-session";

type StoredDiagnosisAnswers = Extract<
  Awaited<ReturnType<typeof d1.action.diagnosis.findDiagnosisAnswers>>,
  { type: "found" }
>["diagnosis"];
type DiagnosisAnswers = Omit<StoredDiagnosisAnswers, "scoringConfig">;

export type DiagnosisAnswersOutcome =
  | {
      type: "resolved";
      diagnosis: DiagnosisAnswers & {
        scoring: ReturnType<typeof scoreDiagnosisAnswers>;
      };
    }
  | { type: "diagnosis-answers-not-found" }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = {
  diagnosisId: string;
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: d1.Client;
  at?: Date;
};

type Dependencies = {
  createSession: typeof createLiffSession;
  findAnswers: typeof d1.action.diagnosis.findDiagnosisAnswers;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  findAnswers: d1.action.diagnosis.findDiagnosisAnswers,
};

/** 本人確認後に、指定Diagnosisへ保存された本人の回答内容を取得します。 */
export async function getDiagnosisAnswers(
  { diagnosisId, idToken, lineLoginChannelId, db, at = new Date() }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<DiagnosisAnswersOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") {
    return session;
  }

  const result = await dependencies.findAnswers(db, session.session.accountId, diagnosisId, at);
  if (result.type !== "found") {
    return { type: "diagnosis-answers-not-found" };
  }
  const { scoringConfig, ...diagnosis } = result.diagnosis;
  return {
    type: "resolved",
    diagnosis: {
      ...diagnosis,
      scoring: scoreDiagnosisAnswers(result.diagnosis.answers, scoringConfig),
    },
  };
}
