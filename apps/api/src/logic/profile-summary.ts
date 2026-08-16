import {
  type AccountDataNamespace,
  type DO,
  type DiagnosisScoring,
  type ProfileSummaryReadModel,
  accountDataFor,
} from "@me-builder/lib";
import { logger, toSafeOperationalErrorFields } from "@me-builder/shared";
import type { AuthenticatedActor } from "./authentication/types";
import { scoreDiagnosisAnswers } from "./diagnosis-scoring";

type ProfileDiagnosisTheme = Readonly<{
  id: string;
  title: string;
  lastAnsweredAt: string;
  answeredCount: number;
  questionCount: number;
  scoring: DiagnosisScoring | null;
}>;

export type ProfileSummaryOutcome = ProfileSummaryReadModel & {
  type: "resolved";
  diagnosisThemes: ProfileDiagnosisTheme[];
  nextAction: "diagnosis" | "chat";
};

type Params = {
  actor: AuthenticatedActor;
  accountData?: AccountDataNamespace;
  at?: Date;
  allowUnchangedRegeneration?: boolean;
};

type Dependencies = {
  getDiagnosisSource: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    at: Date,
  ) => ReturnType<typeof DO.account.action.diagnosis.getDiagnosisAnsweredSource>;
  readProfileSummary: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    at: Date,
    allowUnchangedRegeneration: boolean,
  ) => Promise<ProfileSummaryReadModel>;
};

const defaultDependencies: Dependencies = {
  getDiagnosisSource: (accountData, accountId, at) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("diagnosis.getAnsweredSource", at);
  },
  readProfileSummary: (accountData, accountId, at, allowUnchangedRegeneration) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute(
      "profileSummary.read",
      at,
      allowUnchangedRegeneration,
    );
  },
};

/** 本人のまとめを返し、実際の診断進捗だけから次の行動を決める。 */
export async function getProfileSummary(
  { actor, accountData, at = new Date(), allowUnchangedRegeneration = false }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<ProfileSummaryOutcome> {
  const [diagnosisSource, readModel] = await Promise.all([
    dependencies.getDiagnosisSource(accountData, actor.accountId, at),
    dependencies.readProfileSummary(accountData, actor.accountId, at, allowUnchangedRegeneration),
  ]);
  const diagnoses = diagnosisSource.diagnoses;
  const hasAnswerableDiagnosis = diagnoses.some(
    ({ availability, responseStatus }) => availability === "open" && responseStatus !== "answered",
  );
  const answeredDiagnoses = diagnoses
    .filter(
      (diagnosis): diagnosis is typeof diagnosis & { lastAnsweredAt: string } =>
        diagnosis.responseStatus === "answered" && typeof diagnosis.lastAnsweredAt === "string",
    )
    .sort(
      (left, right) =>
        right.lastAnsweredAt.localeCompare(left.lastAnsweredAt) ||
        left.displayOrder - right.displayOrder ||
        left.id.localeCompare(right.id),
    );
  const answersByDiagnosisId = new Map(
    diagnosisSource.answeredDiagnoses.map((diagnosis) => [diagnosis.id, diagnosis]),
  );
  const diagnosisThemes = answeredDiagnoses.map(({ id, title, lastAnsweredAt }) => {
    const diagnosis = answersByDiagnosisId.get(id);
    if (!diagnosis) {
      throw new Error(`Answered diagnosis ${id} could not be loaded`);
    }
    let scoring: DiagnosisScoring | null = null;
    try {
      scoring = scoreDiagnosisAnswers(diagnosis.answers, diagnosis.scoringConfig);
    } catch (error) {
      logger.warn(
        {
          event: "diagnosis.scoring.skipped",
          service: "api",
          component: "profile-summary",
          diagnosisId: id,
          scoringConfigId: diagnosis.scoringConfig?.id,
          outcome: "degraded",
          ...toSafeOperationalErrorFields(error, {
            code: "DIAGNOSIS_SCORING_CONFIG_INVALID",
            category: "invariant",
            stage: "diagnosis.score",
            retryable: false,
          }),
        },
        `[Profile summary] degraded at diagnosis.score -> theme returned without scoring (diagnosis ${id}, DIAGNOSIS_SCORING_CONFIG_INVALID)`,
      );
    }
    return {
      id,
      title,
      lastAnsweredAt,
      answeredCount: diagnosis.answeredCount,
      questionCount: diagnosis.questionCount,
      scoring,
    };
  });

  return {
    type: "resolved",
    ...readModel,
    diagnosisThemes,
    nextAction: hasAnswerableDiagnosis ? "diagnosis" : "chat",
  };
}
