import { accountData } from "@me-builder/lib";

/** Diagnosis answer and derived Brain projection operations owned by one AccountData Object. */
export const diagnosisActions = {
  "diagnosis.deleteAccountData": (db: accountData.Database, accountId: string) =>
    accountData.action.diagnosis.deleteAccountDiagnosisData(db, accountId),
  "diagnosis.deferQuestion": (
    db: accountData.Database,
    accountId: string,
    input: Omit<
      Parameters<typeof accountData.action.diagnosis.deferDiagnosisQuestion>[1],
      "accountId"
    >,
  ) => accountData.action.diagnosis.deferDiagnosisQuestion(db, { ...input, accountId }),
  "diagnosis.saveAnswer": (
    db: accountData.Database,
    accountId: string,
    input: Omit<
      Parameters<typeof accountData.action.diagnosis.saveDiagnosisAnswer>[1],
      "accountId"
    >,
  ) => accountData.action.diagnosis.saveDiagnosisAnswer(db, { ...input, accountId }),
  "diagnosis.findAnswers": (
    db: accountData.Database,
    accountId: string,
    diagnosisId: string,
    at: Date,
  ) => accountData.action.diagnosis.findDiagnosisAnswers(db, accountId, diagnosisId, at),
  "diagnosis.listVisible": (db: accountData.Database, accountId: string, at: Date) =>
    accountData.action.diagnosis.listVisibleDiagnoses(db, accountId, at),
  "diagnosisProjection.processLatest": (
    db: accountData.Database,
    accountId: string,
    diagnosisId: string,
    at?: Date,
  ) =>
    accountData.action.diagnosisBrainProjection.processLatestDiagnosisBrainProjection(
      db,
      accountId,
      diagnosisId,
      at,
    ),
} as const;
