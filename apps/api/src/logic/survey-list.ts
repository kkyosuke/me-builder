import { d1 } from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

export type SurveyListOutcome =
  | {
      type: "resolved";
      surveys: Awaited<ReturnType<typeof d1.action.questionnaire.listVisibleSurveys>>;
    }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type SurveyListParams = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: d1.Client;
  at?: Date;
};

type SurveyListDependencies = {
  createSession: typeof createLiffSession;
  listVisibleSurveys: typeof d1.action.questionnaire.listVisibleSurveys;
};

const defaultDependencies: SurveyListDependencies = {
  createSession: createLiffSession,
  listVisibleSurveys: d1.action.questionnaire.listVisibleSurveys,
};

/**
 * LIFF の本人確認結果から Account を解決し、その Account の回答進捗を含む一覧を返します。
 * HTTP の認証ヘッダーやステータスコードは controller 側の責務です。
 */
export async function getSurveyList(
  { idToken, lineLoginChannelId, db, at = new Date() }: SurveyListParams,
  dependencies: SurveyListDependencies = defaultDependencies,
): Promise<SurveyListOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });

  if (session.type !== "resolved") {
    return session;
  }

  const surveys = await dependencies.listVisibleSurveys(db, session.session.accountId, at);
  return { type: "resolved", surveys };
}
