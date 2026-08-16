import { type AccountDataNamespace, D1, type DO, accountDataFor } from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";

type DiagnosisDetail = Extract<
  Awaited<ReturnType<typeof D1.shared.action.catalog.findOpenDiagnosisDetail>>,
  { type: "found" }
>["diagnosis"];

export type DiagnosisDetailOutcome =
  | { type: "resolved"; diagnosis: DiagnosisDetail }
  | { type: "diagnosis-not-found" }
  | { type: "diagnosis-closed" };

type DiagnosisDetailParams = {
  diagnosisId: string;
  actor: AuthenticatedActor;
  db: D1.shared.Client;
  accountData?: AccountDataNamespace;
  at?: Date;
};

type DiagnosisDetailDependencies = {
  findOpenDiagnosisDetail: typeof D1.shared.action.catalog.findOpenDiagnosisDetail;
  hasDiagnosisResponse: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    diagnosisId: string,
  ) => ReturnType<typeof DO.account.action.diagnosis.hasDiagnosisResponse>;
};

const defaultDependencies: DiagnosisDetailDependencies = {
  findOpenDiagnosisDetail: D1.shared.action.catalog.findOpenDiagnosisDetail,
  hasDiagnosisResponse: (accountData, accountId, diagnosisId) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("diagnosis.hasResponse", diagnosisId);
  },
};

/** 本人確認後に、受付中または公開停止前にResponseを作成済みのDiagnosis詳細を返します。 */
export async function getDiagnosisDetail(
  { diagnosisId, actor, db, accountData, at = new Date() }: DiagnosisDetailParams,
  dependencies: DiagnosisDetailDependencies = defaultDependencies,
): Promise<DiagnosisDetailOutcome> {
  let result = await dependencies.findOpenDiagnosisDetail(db, diagnosisId, at);
  if (result.type === "not-found") {
    const hasResponse = await dependencies.hasDiagnosisResponse(
      accountData,
      actor.accountId,
      diagnosisId,
    );
    if (hasResponse) {
      result = await dependencies.findOpenDiagnosisDetail(db, diagnosisId, at, {
        allowWithdrawn: true,
      });
    }
  }
  if (result.type === "not-found") {
    return { type: "diagnosis-not-found" };
  }
  if (result.type === "closed") {
    return { type: "diagnosis-closed" };
  }
  return { type: "resolved", diagnosis: result.diagnosis };
}
