import { d1 } from "@me-builder/lib";

/** Diagnosis answer and derived Brain projection operations owned by one AccountData Object. */
export const diagnosisActions = {
  "diagnosis.deleteAccountData": (db: d1.Client, accountId: string) =>
    d1.action.diagnosis.deleteAccountDiagnosisData(db, accountId),
  "diagnosis.deferQuestion": (
    db: d1.Client,
    accountId: string,
    input: Omit<Parameters<typeof d1.action.diagnosis.deferDiagnosisQuestion>[1], "accountId">,
  ) => d1.action.diagnosis.deferDiagnosisQuestion(db, { ...input, accountId }),
  "diagnosis.saveAnswer": (
    db: d1.Client,
    accountId: string,
    input: Omit<Parameters<typeof d1.action.diagnosis.saveDiagnosisAnswer>[1], "accountId">,
  ) => d1.action.diagnosis.saveDiagnosisAnswer(db, { ...input, accountId }),
  "diagnosis.findAnswers": (db: d1.Client, accountId: string, diagnosisId: string, at: Date) =>
    d1.action.diagnosis.findDiagnosisAnswers(db, accountId, diagnosisId, at),
  "diagnosis.findProfileSummaryData": (db: d1.Client, accountId: string, at: Date) =>
    d1.action.diagnosis.findProfileSummaryDiagnosisData(db, accountId, at),
  "diagnosis.listVisible": (db: d1.Client, accountId: string, at: Date) =>
    d1.action.diagnosis.listVisibleDiagnoses(db, accountId, at),
  "diagnosisProjection.processLatest": (
    db: d1.Client,
    accountId: string,
    diagnosisId: string,
    at?: Date,
  ) =>
    d1.action.diagnosisBrainProjection.processLatestDiagnosisBrainProjection(
      db,
      accountId,
      diagnosisId,
      at,
    ),
} as const;
