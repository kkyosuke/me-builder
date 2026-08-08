import { d1 } from "@me-builder/lib";
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

export type ProfileSummaryOutcome =
  | {
      type: "resolved";
      summary: typeof DUMMY_SUMMARY | null;
      nextAction: "diagnosis" | "chat";
    }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: d1.Client;
  at?: Date;
};

type Dependencies = {
  createSession: typeof createLiffSession;
  listVisibleDiagnoses: typeof d1.action.diagnosis.listVisibleDiagnoses;
  hasActiveSourceRecords: typeof d1.action.source.hasActiveSourceRecords;
  summary: typeof DUMMY_SUMMARY | null;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  listVisibleDiagnoses: d1.action.diagnosis.listVisibleDiagnoses,
  hasActiveSourceRecords: d1.action.source.hasActiveSourceRecords,
  summary: DUMMY_SUMMARY,
};

/** 本人のまとめを返し、実際の診断進捗だけから次の行動を決める。 */
export async function getProfileSummary(
  { idToken, lineLoginChannelId, db, at = new Date() }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<ProfileSummaryOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;

  const [diagnoses, hasRecords] = await Promise.all([
    dependencies.listVisibleDiagnoses(db, session.session.accountId, at),
    dependencies.hasActiveSourceRecords(db, session.session.accountId),
  ]);
  const hasAnswerableDiagnosis = diagnoses.some(
    ({ availability, responseStatus }) => availability === "open" && responseStatus !== "answered",
  );

  return {
    type: "resolved",
    summary: hasRecords ? dependencies.summary : null,
    nextAction: hasAnswerableDiagnosis ? "diagnosis" : "chat",
  };
}
