import { type AccountDataNamespace, accountDataFor, type d1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { createLiffSession } from "./liff-session";

type SavedAnswer = Extract<
  Awaited<ReturnType<typeof d1.action.diagnosis.saveDiagnosisAnswer>>,
  { type: "saved" }
>;

export type SaveDiagnosisAnswerOutcome =
  | SavedAnswer
  | { type: "diagnosis-not-found" }
  | { type: "diagnosis-closed" }
  | { type: "diagnosis-question-not-found" }
  | { type: "choice-not-found" }
  | { type: "answer-conflict" }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type SaveDiagnosisAnswerParams = {
  diagnosisId: string;
  diagnosisQuestionId: string;
  choiceId: string;
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: d1.Client;
  accountData?: AccountDataNamespace;
  at?: Date;
  scheduleProjection?: (task: () => Promise<void>) => void;
};

type Dependencies = {
  createSession: typeof createLiffSession;
  saveAnswer: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    input: Omit<Parameters<typeof d1.action.diagnosis.saveDiagnosisAnswer>[1], "accountId">,
  ) => ReturnType<typeof d1.action.diagnosis.saveDiagnosisAnswer>;
  processLatestProjection?: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    diagnosisId: string,
    at: Date,
  ) => ReturnType<typeof d1.action.diagnosisBrainProjection.processLatestDiagnosisBrainProjection>;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  saveAnswer: (accountData, accountId, input) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("diagnosis.saveAnswer", input);
  },
  processLatestProjection: (accountData, accountId, diagnosisId, at) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute(
      "diagnosisProjection.processLatest",
      diagnosisId,
      at,
    );
  },
};

/** 本人確認結果からAccountを解決し、その本人の1問分の回答だけを保存します。 */
export async function saveDiagnosisAnswer(
  {
    diagnosisId,
    diagnosisQuestionId,
    choiceId,
    idToken,
    lineLoginChannelId,
    db,
    accountData,
    at = new Date(),
    scheduleProjection,
  }: SaveDiagnosisAnswerParams,
  dependencies: Dependencies = defaultDependencies,
): Promise<SaveDiagnosisAnswerOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") {
    return session;
  }
  const result = await dependencies.saveAnswer(accountData, session.session.accountId, {
    diagnosisId,
    diagnosisQuestionId,
    choiceId,
    at,
  });
  if (result.type === "saved" && result.progress.responseStatus === "answered") {
    const task = async () => {
      try {
        await (
          dependencies.processLatestProjection ?? defaultDependencies.processLatestProjection
        )?.(accountData, session.session.accountId, diagnosisId, at);
      } catch (error) {
        logger.error(
          {
            diagnosisId,
            reason: error instanceof Error ? error.name : "unknown",
          },
          "Diagnosis Brain projection failed; scheduled retry will recover it",
        );
      }
    };
    if (scheduleProjection) scheduleProjection(task);
    else void task();
  }
  return result;
}
