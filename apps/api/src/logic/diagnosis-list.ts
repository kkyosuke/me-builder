import { type AccountDataNamespace, type DO, accountDataFor } from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";

export type DiagnosisListOutcome = {
  type: "resolved";
  diagnoses: Awaited<ReturnType<typeof DO.account.action.diagnosis.listVisibleDiagnoses>>;
};

type DiagnosisListParams = {
  actor: AuthenticatedActor;
  accountData?: AccountDataNamespace;
  at?: Date;
};

type DiagnosisListDependencies = {
  listVisibleDiagnoses: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    at: Date,
  ) => ReturnType<typeof DO.account.action.diagnosis.listVisibleDiagnoses>;
};

const defaultDependencies: DiagnosisListDependencies = {
  listVisibleDiagnoses: (accountData, accountId, at) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("diagnosis.listVisible", at);
  },
};

/**
 * 認証済みactorのAccountについて、回答進捗を含む一覧を返します。
 */
export async function getDiagnosisList(
  { actor, accountData, at = new Date() }: DiagnosisListParams,
  dependencies: DiagnosisListDependencies = defaultDependencies,
): Promise<DiagnosisListOutcome> {
  const diagnoses = await dependencies.listVisibleDiagnoses(accountData, actor.accountId, at);
  return { type: "resolved", diagnoses };
}
