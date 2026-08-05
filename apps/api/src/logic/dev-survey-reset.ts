import { d1 } from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

type DeletedSurveyData = Awaited<
  ReturnType<typeof d1.action.questionnaire.deleteAccountSurveyData>
>;

export type ResetDevelopmentSurveyDataOutcome =
  | ({ type: "resolved" } & DeletedSurveyData)
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: d1.Client;
};

type Dependencies = {
  createSession: typeof createLiffSession;
  deleteSurveyData: typeof d1.action.questionnaire.deleteAccountSurveyData;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  deleteSurveyData: d1.action.questionnaire.deleteAccountSurveyData,
};

/** 本人確認後に、本人のアンケート回答由来データを開発用に物理削除します。 */
export async function resetDevelopmentSurveyData(
  { idToken, lineLoginChannelId, db }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<ResetDevelopmentSurveyDataOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") {
    return session;
  }

  const deleted = await dependencies.deleteSurveyData(db, session.session.accountId);
  return { type: "resolved", ...deleted };
}
