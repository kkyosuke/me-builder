import { type AccountDataNamespace, type DO, accountDataFor } from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";

type Deferred = Extract<
  Awaited<ReturnType<typeof DO.account.action.diagnosis.deferDiagnosisQuestion>>,
  { type: "deferred" }
>;

export type DeferDiagnosisQuestionOutcome =
  | Deferred
  | { type: "diagnosis-not-found" }
  | { type: "diagnosis-closed" }
  | { type: "diagnosis-question-not-found" }
  | { type: "question-already-answered" };

type Params = {
  diagnosisId: string;
  diagnosisQuestionId: string;
  actor: AuthenticatedActor;
  accountData?: AccountDataNamespace;
  at?: Date;
};

type Dependencies = {
  deferQuestion: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    input: Omit<
      Parameters<typeof DO.account.action.diagnosis.deferDiagnosisQuestion>[1],
      "accountId"
    >,
  ) => ReturnType<typeof DO.account.action.diagnosis.deferDiagnosisQuestion>;
};

const defaultDependencies: Dependencies = {
  deferQuestion: (accountData, accountId, input) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("diagnosis.deferQuestion", input);
  },
};

/** 本人確認結果からAccountを解決し、その本人の延期操作だけを保存します。 */
export async function deferDiagnosisQuestion(
  { diagnosisId, diagnosisQuestionId, actor, accountData, at = new Date() }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<DeferDiagnosisQuestionOutcome> {
  return dependencies.deferQuestion(accountData, actor.accountId, {
    diagnosisId,
    diagnosisQuestionId,
    at,
  });
}
