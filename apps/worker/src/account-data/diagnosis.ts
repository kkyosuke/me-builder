import { d1 } from "@me-builder/lib";

/** Diagnosis answer and derived Brain projection operations owned by one AccountData Object. */
export const diagnosisActions = {
  "diagnosis.deleteAccountData": d1.action.diagnosis.deleteAccountDiagnosisData,
  "diagnosis.deferQuestion": d1.action.diagnosis.deferDiagnosisQuestion,
  "diagnosis.saveAnswer": d1.action.diagnosis.saveDiagnosisAnswer,
  "diagnosis.findAnswers": d1.action.diagnosis.findDiagnosisAnswers,
  "diagnosis.listVisible": d1.action.diagnosis.listVisibleDiagnoses,
  "diagnosisProjection.processRequest":
    d1.action.diagnosisBrainProjection.processDiagnosisBrainProjectionRequest,
  "diagnosisProjection.processLatest":
    d1.action.diagnosisBrainProjection.processLatestDiagnosisBrainProjection,
  "diagnosisProjection.processPending":
    d1.action.diagnosisBrainProjection.processPendingDiagnosisBrainProjections,
} as const;
