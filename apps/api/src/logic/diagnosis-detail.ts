import { sharedD1 } from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

type DiagnosisDetail = Extract<
  Awaited<ReturnType<typeof sharedD1.action.catalog.findOpenDiagnosisDetail>>,
  { type: "found" }
>["diagnosis"];

export type DiagnosisDetailOutcome =
  | { type: "resolved"; diagnosis: DiagnosisDetail }
  | { type: "diagnosis-not-found" }
  | { type: "diagnosis-closed" }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type DiagnosisDetailParams = {
  diagnosisId: string;
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: sharedD1.Client;
  at?: Date;
};

type DiagnosisDetailDependencies = {
  createSession: typeof createLiffSession;
  findOpenDiagnosisDetail: typeof sharedD1.action.catalog.findOpenDiagnosisDetail;
};

const defaultDependencies: DiagnosisDetailDependencies = {
  createSession: createLiffSession,
  findOpenDiagnosisDetail: sharedD1.action.catalog.findOpenDiagnosisDetail,
};

/** 本人確認後に、新規回答を開始できるDiagnosisの公開済みQuestion Versionを返します。 */
export async function getDiagnosisDetail(
  { diagnosisId, idToken, lineLoginChannelId, db, at = new Date() }: DiagnosisDetailParams,
  dependencies: DiagnosisDetailDependencies = defaultDependencies,
): Promise<DiagnosisDetailOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") {
    return session;
  }

  const result = await dependencies.findOpenDiagnosisDetail(db, diagnosisId, at);
  if (result.type === "not-found") {
    return { type: "diagnosis-not-found" };
  }
  if (result.type === "closed") {
    return { type: "diagnosis-closed" };
  }
  return { type: "resolved", diagnosis: result.diagnosis };
}
