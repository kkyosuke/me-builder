import { type AccountDataNamespace, type DO, accountDataFor } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { AuthenticatedActor } from "./authentication/types";

type SavedAnswer = Extract<
  Awaited<ReturnType<typeof DO.account.action.diagnosis.saveDiagnosisAnswer>>,
  { type: "saved" }
>;

export type SaveDiagnosisAnswerOutcome =
  | SavedAnswer
  | { type: "diagnosis-not-found" }
  | { type: "diagnosis-closed" }
  | { type: "diagnosis-question-not-found" }
  | { type: "choice-not-found" }
  | { type: "answer-conflict" };

type SaveDiagnosisAnswerParams = {
  diagnosisId: string;
  diagnosisQuestionId: string;
  choiceId: string;
  actor: AuthenticatedActor;
  accountData?: AccountDataNamespace;
  at?: Date;
  scheduleProjection?: (task: () => Promise<void>) => void;
};

type Dependencies = {
  saveAnswer: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    input: Omit<Parameters<typeof DO.account.action.diagnosis.saveDiagnosisAnswer>[1], "accountId">,
  ) => ReturnType<typeof DO.account.action.diagnosis.saveDiagnosisAnswer>;
  processLatestProjection?: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    diagnosisId: string,
    at: Date,
  ) => ReturnType<
    typeof DO.account.action.diagnosisBrainProjection.processLatestDiagnosisBrainProjection
  >;
};

const defaultDependencies: Dependencies = {
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
    actor,
    accountData,
    at = new Date(),
    scheduleProjection,
  }: SaveDiagnosisAnswerParams,
  dependencies: Dependencies = defaultDependencies,
): Promise<SaveDiagnosisAnswerOutcome> {
  const result = await dependencies.saveAnswer(accountData, actor.accountId, {
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
        )?.(accountData, actor.accountId, diagnosisId, at);
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
