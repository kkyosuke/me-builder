import {
  type AccountDataNamespace,
  type D1,
  type DO,
  type DiagnosisScoring,
  type ProfileSummaryReadModel,
  accountDataFor,
} from "@me-builder/lib";
import { logger, toSafeOperationalErrorFields } from "@me-builder/shared";
import { scoreDiagnosisAnswers } from "./diagnosis-scoring";
import { createLiffSession } from "./liff-session";

type ProfileDiagnosisTheme = Readonly<{
  id: string;
  title: string;
  lastAnsweredAt: string;
  answeredCount: number;
  questionCount: number;
  scoring: DiagnosisScoring | null;
}>;

export type ProfileSummaryOutcome =
  | (ProfileSummaryReadModel & {
      type: "resolved";
      diagnosisThemes: ProfileDiagnosisTheme[];
      nextAction: "diagnosis" | "chat";
    })
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData?: AccountDataNamespace;
  at?: Date;
  allowUnchangedRegeneration?: boolean;
};

type Dependencies = {
  createSession: typeof createLiffSession;
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
  createSession: createLiffSession,
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
  {
    idToken,
    lineLoginChannelId,
    db,
    accountData,
    at = new Date(),
    allowUnchangedRegeneration = false,
  }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<ProfileSummaryOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;

  const [diagnosisSource, readModel] = await Promise.all([
    dependencies.getDiagnosisSource(accountData, session.session.accountId, at),
    dependencies.readProfileSummary(
      accountData,
      session.session.accountId,
      at,
      allowUnchangedRegeneration,
    ),
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
