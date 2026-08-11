/**
 * AccountData内に同居する公開定義のsnapshot。
 *
 * table定義の正本は共有D1にあり、AccountDataは同じ定義を自分のSQLiteへ適用して
 * 版が進んだときだけ同期する。Account所有tableではないため`index.ts`へは含めない。
 */
export {
  catalogVersions,
  diagnoses,
  diagnosisQuestions,
  diagnosisScoringConfigs,
  questionChoices,
  questionVersions,
  questions,
} from "../../../d1/shared/schema/catalog";
