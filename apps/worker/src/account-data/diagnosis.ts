import { DO } from "@me-builder/lib";

/** Diagnosis answer and derived Brain projection operations owned by one AccountData Object. */
export const diagnosisActions = {
  "diagnosis.deleteAccountData": (db: DO.account.Database, accountId: string) =>
    DO.account.action.diagnosis.deleteAccountDiagnosisData(db, accountId),
  "diagnosis.deferQuestion": (
    db: DO.account.Database,
    accountId: string,
    input: Omit<
      Parameters<typeof DO.account.action.diagnosis.deferDiagnosisQuestion>[1],
      "accountId"
    >,
  ) => DO.account.action.diagnosis.deferDiagnosisQuestion(db, { ...input, accountId }),
  "diagnosis.saveAnswer": (
    db: DO.account.Database,
    accountId: string,
    input: Omit<Parameters<typeof DO.account.action.diagnosis.saveDiagnosisAnswer>[1], "accountId">,
  ) => DO.account.action.diagnosis.saveDiagnosisAnswer(db, { ...input, accountId }),
  "diagnosis.findAnswers": (
    db: DO.account.Database,
    accountId: string,
    diagnosisId: string,
    at: Date,
  ) => DO.account.action.diagnosis.findDiagnosisAnswers(db, accountId, diagnosisId, at),
  "diagnosis.getCompatibilitySharePreviewSource": (
    db: DO.account.Database,
    accountId: string,
    at: Date,
  ) => DO.account.action.diagnosis.getCompatibilitySharePreviewSource(db, accountId, at),
  "diagnosis.listVisible": (db: DO.account.Database, accountId: string, at: Date) =>
    DO.account.action.diagnosis.listVisibleDiagnoses(db, accountId, at),
  "diagnosisProjection.processLatest": (
    db: DO.account.Database,
    accountId: string,
    diagnosisId: string,
    at?: Date,
  ) =>
    DO.account.action.diagnosisBrainProjection.processLatestDiagnosisBrainProjection(
      db,
      accountId,
      diagnosisId,
      at,
    ),
} as const;
