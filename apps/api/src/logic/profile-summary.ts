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
  listVisibleDiagnoses: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    at: Date,
  ) => ReturnType<typeof DO.account.action.diagnosis.listVisibleDiagnoses>;
  readProfileSummary: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    at: Date,
    allowUnchangedRegeneration: boolean,
  ) => Promise<ProfileSummaryReadModel>;
  findAnswers: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    diagnosisId: string,
    at: Date,
  ) => ReturnType<typeof DO.account.action.diagnosis.findDiagnosisAnswers>;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  listVisibleDiagnoses: (accountData, accountId, at) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("diagnosis.listVisible", at);
  },
  readProfileSummary: (accountData, accountId, at, allowUnchangedRegeneration) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute(
      "profileSummary.read",
      at,
      allowUnchangedRegeneration,
    );
  },
  findAnswers: (accountData, accountId, diagnosisId, at) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("diagnosis.findAnswers", diagnosisId, at);
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

  const [diagnoses, readModel] = await Promise.all([
    dependencies.listVisibleDiagnoses(accountData, session.session.accountId, at),
    dependencies.readProfileSummary(
      accountData,
      session.session.accountId,
      at,
      allowUnchangedRegeneration,
    ),
  ]);
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
  const diagnosisThemes = await Promise.all(
    answeredDiagnoses.map(async ({ id, title, lastAnsweredAt }) => {
      const result = await dependencies.findAnswers(accountData, session.session.accountId, id, at);
      if (result.type !== "found") {
        throw new Error(`Answered diagnosis ${id} could not be loaded`);
      }
      let scoring: DiagnosisScoring | null = null;
      try {
        scoring = scoreDiagnosisAnswers(result.diagnosis.answers, result.diagnosis.scoringConfig);
      } catch (error) {
        logger.warn(
          {
            event: "diagnosis.scoring.skipped",
            service: "api",
            component: "profile-summary",
            diagnosisId: id,
            scoringConfigId: result.diagnosis.scoringConfig?.id,
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
        answeredCount: result.diagnosis.answeredCount,
        questionCount: result.diagnosis.questionCount,
        scoring,
      };
    }),
  );

  return {
    type: "resolved",
    ...readModel,
    diagnosisThemes,
    nextAction: hasAnswerableDiagnosis ? "diagnosis" : "chat",
  };
}
