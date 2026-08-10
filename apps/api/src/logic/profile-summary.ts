import { type AccountDataNamespace, accountDataFor, type d1 } from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

const DUMMY_SUMMARY = {
  generatedAt: "2026-08-08T12:00:00.000Z",
  headline: "最近の記録から、こんなあなたらしさが見えています",
  insights: [
    {
      key: "prepare-first",
      label: "見通しを持って動く",
      description: "先の段取りが見えると、安心して力を発揮できる傾向があります。",
      evidenceCount: 2,
      sources: ["diagnosis", "diary"] as const,
    },
    {
      key: "own-pace",
      label: "自分のペースを守る",
      description: "相手を尊重しながらも、自分の余裕を確かめて選ぶことを大切にしています。",
      evidenceCount: 2,
      sources: ["diagnosis"] as const,
    },
    {
      key: "talk-to-organize",
      label: "話しながら整理する",
      description: "信頼できる人との対話から、次の一歩を見つけることがあります。",
      evidenceCount: 2,
      sources: ["diary"] as const,
    },
  ],
  recordCount: 4,
  diagnosisCount: 2,
  diaryCount: 2,
  latestRecordedAt: "2026-08-08T11:45:00.000Z",
} as const;

const DUMMY_PROFILE_SUMMARY_READ_MODEL = {
  versions: [
    {
      id: "summary-version-3",
      sequence: 3,
      generatedAt: DUMMY_SUMMARY.generatedAt,
      isLatest: true,
      generationMethod: "ai" as const,
      summary: DUMMY_SUMMARY,
    },
    {
      id: "summary-version-2",
      sequence: 2,
      generatedAt: "2026-08-01T12:00:00.000Z",
      isLatest: false,
      generationMethod: "ai" as const,
      summary: {
        ...DUMMY_SUMMARY,
        generatedAt: "2026-08-01T12:00:00.000Z",
        headline: "少し前の記録では、こんなあなたらしさが見えていました",
        insights: DUMMY_SUMMARY.insights.slice(0, 2),
        recordCount: 3,
        diagnosisCount: 2,
        diaryCount: 1,
        latestRecordedAt: "2026-08-01T11:30:00.000Z",
      },
    },
    {
      id: "summary-version-1",
      sequence: 1,
      generatedAt: "2026-07-24T12:00:00.000Z",
      isLatest: false,
      generationMethod: "ai" as const,
      summary: {
        ...DUMMY_SUMMARY,
        generatedAt: "2026-07-24T12:00:00.000Z",
        headline: "最初の記録から、こんなあなたらしさが見えていました",
        insights: DUMMY_SUMMARY.insights.slice(0, 1),
        recordCount: 2,
        diagnosisCount: 1,
        diaryCount: 1,
        latestRecordedAt: "2026-07-24T11:15:00.000Z",
      },
    },
  ],
  availableDataCounts: { diagnosis: 3, diary: 6 },
  generation: {
    status: "idle" as const,
    canRegenerate: false,
    reasons: [],
    message: null,
  },
} as const;

export type ProfileSummaryOutcome =
  | {
      type: "resolved";
      versions: typeof DUMMY_PROFILE_SUMMARY_READ_MODEL.versions | readonly [];
      availableDataCounts: Readonly<{ diagnosis: number; diary: number }>;
      generation: typeof DUMMY_PROFILE_SUMMARY_READ_MODEL.generation;
      nextAction: "diagnosis" | "chat";
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

type Dependencies = {
  createSession: typeof createLiffSession;
  listVisibleDiagnoses: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    at: Date,
  ) => ReturnType<typeof d1.action.diagnosis.listVisibleDiagnoses>;
  hasActiveSourceRecords: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
  ) => ReturnType<typeof d1.action.source.hasActiveSourceRecords>;
  readModel: typeof DUMMY_PROFILE_SUMMARY_READ_MODEL;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  listVisibleDiagnoses: (accountData, accountId, at) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("diagnosis.listVisible", at);
  },
  hasActiveSourceRecords: (accountData, accountId) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("source.hasActive");
  },
  readModel: DUMMY_PROFILE_SUMMARY_READ_MODEL,
};

/** 本人のまとめを返し、実際の診断進捗だけから次の行動を決める。 */
export async function getProfileSummary(
  { idToken, lineLoginChannelId, db, accountData, at = new Date() }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<ProfileSummaryOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;

  const [diagnoses, hasRecords] = await Promise.all([
    dependencies.listVisibleDiagnoses(accountData, session.session.accountId, at),
    dependencies.hasActiveSourceRecords(accountData, session.session.accountId),
  ]);
  const hasAnswerableDiagnosis = diagnoses.some(
    ({ availability, responseStatus }) => availability === "open" && responseStatus !== "answered",
  );

  return {
    type: "resolved",
    versions: hasRecords ? dependencies.readModel.versions : [],
    availableDataCounts: hasRecords
      ? dependencies.readModel.availableDataCounts
      : { diagnosis: 0, diary: 0 },
    generation: dependencies.readModel.generation,
    nextAction: hasAnswerableDiagnosis ? "diagnosis" : "chat",
  };
}
