import { type AccountDataNamespace, accountDataFor, type d1 } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { scoreDiagnosisAnswers } from "./diagnosis-scoring";
import { createLiffSession } from "./liff-session";

type ProfileInsight = Readonly<{
  key: string;
  label: string;
  description: string;
  evidenceCount: number;
  sources: readonly ["diagnosis"];
}>;

type ProfileTheme = Readonly<{
  diagnosisId: string;
  title: string;
  answerCount: number;
  lastAnsweredAt: string;
  scoring: Readonly<{
    balancedLabel: string;
    parameters: NonNullable<ReturnType<typeof scoreDiagnosisAnswers>>["parameters"];
  }> | null;
}>;

type ProfileDiaryMemory = Readonly<{
  id: string;
  statement: string;
  recordedAt: string;
  evidenceCount: number;
}>;

export type ProfileSummary = Readonly<{
  generatedAt: string;
  headline: string;
  insights: readonly ProfileInsight[];
  themes: readonly ProfileTheme[];
  diaryMemories: readonly ProfileDiaryMemory[];
  recordCount: number;
  diagnosisCount: number;
  diaryCount: number;
  latestRecordedAt: string | null;
}>;

export type ProfileSummaryOutcome =
  | {
      type: "resolved";
      summary: ProfileSummary | null;
      nextAction: "diagnosis" | null;
    }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: d1.Client;
  accountData?: AccountDataNamespace;
  at?: Date;
};

type DiagnosisSummaryData = Awaited<
  ReturnType<typeof d1.action.diagnosis.findProfileSummaryDiagnosisData>
>;
type DiarySummaryData = Awaited<ReturnType<typeof d1.action.brain.findProfileSummaryDiaryData>>;

type Dependencies = {
  createSession: typeof createLiffSession;
  findSummaryData: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    at: Date,
  ) => Promise<DiagnosisSummaryData>;
  findDiaryData: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
  ) => Promise<DiarySummaryData>;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  findSummaryData: (accountData, accountId, at) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("diagnosis.findProfileSummaryData", at);
  },
  findDiaryData: (accountData, accountId) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("brain.findProfileSummaryDiaryData");
  },
};

type InsightCandidate = ProfileInsight & {
  distance: number;
  diagnosisDisplayOrder: number;
  diagnosisId: string;
  parameterPosition: number;
  parameterId: string;
};

function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function buildSummary(
  data: DiagnosisSummaryData,
  diaryData: DiarySummaryData,
  at: Date,
): ProfileSummary | null {
  if (data.completedDiagnoses.length === 0 && diaryData.memoryCount === 0) return null;

  const candidates: InsightCandidate[] = [];
  const themes: ProfileTheme[] = [];
  let hasScoring = false;
  let hasBalancedParameter = false;

  for (const { displayOrder, diagnosis } of data.completedDiagnoses) {
    let scoring: ReturnType<typeof scoreDiagnosisAnswers> = null;
    try {
      scoring = scoreDiagnosisAnswers(diagnosis.answers, diagnosis.scoringConfig);
    } catch (error) {
      logger.error(
        {
          diagnosisId: diagnosis.id,
          scoringConfigId: diagnosis.scoringConfig?.id,
          reason: error instanceof Error ? error.message : "unknown error",
        },
        "Diagnosis scoring config is invalid; excluding it from profile summary",
      );
      scoring = null;
    }
    const lastAnsweredAt = diagnosis.answers
      .map(({ acceptedAt }) => acceptedAt)
      .sort((left, right) => right.localeCompare(left))[0];
    if (!lastAnsweredAt) throw new Error("完了済み診断に回答がありません");
    themes.push({
      diagnosisId: diagnosis.id,
      title: diagnosis.title,
      answerCount: diagnosis.answers.length,
      lastAnsweredAt,
      scoring: scoring
        ? { balancedLabel: scoring.balancedLabel, parameters: scoring.parameters }
        : null,
    });

    if (scoring) {
      hasScoring = true;
      scoring.parameters.forEach((parameter, parameterPosition) => {
        if (parameter.band === "balanced") hasBalancedParameter = true;
        if ((parameter.band !== "low" && parameter.band !== "high") || parameter.score === null) {
          return;
        }
        const label = parameter.band === "low" ? parameter.lowLabel : parameter.highLabel;
        candidates.push({
          key: `${diagnosis.id}:${parameter.id}`,
          label,
          description: `「${label}」傾向があります`,
          evidenceCount: parameter.evidenceCount,
          sources: ["diagnosis"],
          distance: Math.abs(parameter.score - 50),
          diagnosisDisplayOrder: displayOrder,
          diagnosisId: diagnosis.id,
          parameterPosition,
          parameterId: parameter.id,
        });
      });
    }
  }

  themes.sort(
    (left, right) =>
      right.lastAnsweredAt.localeCompare(left.lastAnsweredAt) ||
      compareIds(left.diagnosisId, right.diagnosisId),
  );

  candidates.sort(
    (left, right) =>
      right.distance - left.distance ||
      left.diagnosisDisplayOrder - right.diagnosisDisplayOrder ||
      compareIds(left.diagnosisId, right.diagnosisId) ||
      left.parameterPosition - right.parameterPosition ||
      compareIds(left.parameterId, right.parameterId),
  );

  const latestDiagnosisRecordedAt = data.completedDiagnoses
    .flatMap(({ diagnosis }) => diagnosis.answers.map(({ acceptedAt }) => acceptedAt))
    .sort((left, right) => right.localeCompare(left))[0];
  const latestRecordedAt = [latestDiagnosisRecordedAt, diaryData.memories[0]?.recordedAt]
    .filter((value): value is string => value !== undefined)
    .sort((left, right) => right.localeCompare(left))[0];
  const insights = candidates
    .slice(0, 3)
    .map(
      ({
        distance: _distance,
        diagnosisDisplayOrder: _diagnosisDisplayOrder,
        diagnosisId: _diagnosisId,
        parameterPosition: _parameterPosition,
        parameterId: _parameterId,
        ...insight
      }) => insight,
    );

  const headline =
    insights.length > 0
      ? "これまでの回答から、今の傾向が見えています"
      : hasBalancedParameter
        ? "回答したテーマでは、状況に応じて選び方を調整する傾向が見えています"
        : hasScoring
          ? "回答が増えると、今の傾向を表示できます"
          : data.completedDiagnoses.length > 0
            ? "回答は保存されていますが、傾向はまだ表示できません"
            : "日記から、最近の出来事を振り返れます";

  return {
    generatedAt: at.toISOString(),
    headline,
    insights,
    themes,
    diaryMemories: diaryData.memories,
    recordCount: data.completedDiagnoses.reduce(
      (count, { diagnosis }) => count + diagnosis.answers.length,
      0,
    ),
    diagnosisCount: data.completedDiagnoses.length,
    diaryCount: diaryData.memoryCount,
    latestRecordedAt: latestRecordedAt ?? null,
  };
}

/** 本人の完了済み診断を再採点してまとめ、実際の診断進捗から次の行動を決める。 */
export async function getProfileSummary(
  { idToken, lineLoginChannelId, db, accountData, at = new Date() }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<ProfileSummaryOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;

  const [data, diaryData] = await Promise.all([
    dependencies.findSummaryData(accountData, session.session.accountId, at),
    dependencies.findDiaryData(accountData, session.session.accountId),
  ]);
  const hasAnswerableDiagnosis = data.diagnoses.some(
    ({ availability, responseStatus }) => availability === "open" && responseStatus !== "answered",
  );

  return {
    type: "resolved",
    summary: buildSummary(data, diaryData, at),
    nextAction: hasAnswerableDiagnosis ? "diagnosis" : null,
  };
}
