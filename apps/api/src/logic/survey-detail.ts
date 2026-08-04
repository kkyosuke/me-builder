import { d1 } from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

type SurveyDetail = Extract<
  Awaited<ReturnType<typeof d1.action.questionnaire.findOpenSurveyDetail>>,
  { type: "found" }
>["survey"];

export type SurveyDetailOutcome =
  | { type: "resolved"; survey: SurveyDetail }
  | { type: "survey-not-found" }
  | { type: "survey-closed" }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type SurveyDetailParams = {
  surveyId: string;
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: d1.Client;
  at?: Date;
};

type SurveyDetailDependencies = {
  createSession: typeof createLiffSession;
  findOpenSurveyDetail: typeof d1.action.questionnaire.findOpenSurveyDetail;
};

const defaultDependencies: SurveyDetailDependencies = {
  createSession: createLiffSession,
  findOpenSurveyDetail: d1.action.questionnaire.findOpenSurveyDetail,
};

/** 本人確認後に、新規回答を開始できるSurveyの公開済みQuestion Versionを返します。 */
export async function getSurveyDetail(
  { surveyId, idToken, lineLoginChannelId, db, at = new Date() }: SurveyDetailParams,
  dependencies: SurveyDetailDependencies = defaultDependencies,
): Promise<SurveyDetailOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") {
    return session;
  }

  const result = await dependencies.findOpenSurveyDetail(db, surveyId, at);
  if (result.type === "not-found") {
    return { type: "survey-not-found" };
  }
  if (result.type === "closed") {
    return { type: "survey-closed" };
  }
  return { type: "resolved", survey: result.survey };
}
