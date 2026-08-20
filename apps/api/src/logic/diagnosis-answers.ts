import { type AccountDataNamespace, type DO, accountDataFor } from "@me-builder/lib";
import { logger, toSafeOperationalErrorFields } from "@me-builder/shared";
import type { AuthenticatedActor } from "./authentication/types";
import { scoreDiagnosisAnswers } from "./diagnosis-scoring";

type StoredDiagnosisAnswers = Extract<
  Awaited<ReturnType<typeof DO.account.action.diagnosis.findDiagnosisAnswers>>,
  { type: "found" }
>["diagnosis"];
type DiagnosisAnswers = Omit<StoredDiagnosisAnswers, "scoringConfig">;

export type DiagnosisAnswersOutcome =
  | {
      type: "resolved";
      diagnosis: DiagnosisAnswers & {
        scoring: ReturnType<typeof scoreDiagnosisAnswers>;
      };
    }
  | { type: "diagnosis-answers-not-found" };

type Params = {
  diagnosisId: string;
  actor: AuthenticatedActor;
  accountData?: AccountDataNamespace;
  at?: Date;
};

type Dependencies = {
  findAnswers: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    diagnosisId: string,
    at: Date,
  ) => ReturnType<typeof DO.account.action.diagnosis.findDiagnosisAnswers>;
};

const defaultDependencies: Dependencies = {
  findAnswers: (accountData, accountId, diagnosisId, at) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("diagnosis.findAnswers", diagnosisId, at);
  },
};

/** 本人確認後に、指定Diagnosisへ保存された本人の回答内容を取得します。 */
export async function getDiagnosisAnswers(
  { diagnosisId, actor, accountData, at = new Date() }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<DiagnosisAnswersOutcome> {
  const result = await dependencies.findAnswers(accountData, actor.accountId, diagnosisId, at);
  if (result.type !== "found") {
    return { type: "diagnosis-answers-not-found" };
  }
  const { scoringConfig, ...diagnosis } = result.diagnosis;
  let scoring: ReturnType<typeof scoreDiagnosisAnswers> = null;
  try {
    // 回答途中では傾向を生成しない。受付終了後も保存済み回答の閲覧だけを提供する。
    if (diagnosis.responseStatus === "answered") {
      scoring = scoreDiagnosisAnswers(result.diagnosis.answers, scoringConfig);
    }
  } catch (error) {
    // reasonへerror.messageを載せると、採点設定や回答の内容がlogへ流出しうる。
    // ここは採点を諦めて回答閲覧を続ける縮退成功なので、この層が結果を所有して1件記録する。
    logger.warn(
      {
        event: "diagnosis.scoring.skipped",
        service: "api",
        component: "diagnosis-answers",
        diagnosisId,
        scoringConfigId: scoringConfig?.id,
        outcome: "degraded",
        ...toSafeOperationalErrorFields(error, {
          code: "DIAGNOSIS_SCORING_CONFIG_INVALID",
          category: "invariant",
          stage: "diagnosis.score",
          retryable: false,
        }),
      },
      `[Diagnosis answers] degraded at diagnosis.score -> answers returned without scoring (diagnosis ${diagnosisId}, DIAGNOSIS_SCORING_CONFIG_INVALID)`,
    );
  }
  return {
    type: "resolved",
    diagnosis: {
      ...diagnosis,
      scoring,
    },
  };
}
