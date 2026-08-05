import { d1 } from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

type SurveyAnswers = Extract<
  Awaited<ReturnType<typeof d1.action.questionnaire.findSurveyAnswers>>,
  { type: "found" }
>["survey"];

export type SurveyAnswersOutcome =
  | { type: "resolved"; survey: SurveyAnswers }
  | { type: "survey-answers-not-found" }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = {
  surveyId: string;
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: d1.Client;
  at?: Date;
};

type Dependencies = {
  createSession: typeof createLiffSession;
  findAnswers: typeof d1.action.questionnaire.findSurveyAnswers;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  findAnswers: d1.action.questionnaire.findSurveyAnswers,
};

/** 本人確認後に、指定Surveyへ保存された本人の回答内容を取得します。 */
export async function getSurveyAnswers(
  { surveyId, idToken, lineLoginChannelId, db, at = new Date() }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<SurveyAnswersOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") {
    return session;
  }

  const result = await dependencies.findAnswers(db, session.session.accountId, surveyId, at);
  return result.type === "found"
    ? { type: "resolved", survey: result.survey }
    : { type: "survey-answers-not-found" };
}
