import { d1 } from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

type SavedAnswer = Extract<
  Awaited<ReturnType<typeof d1.action.questionnaire.saveSurveyAnswer>>,
  { type: "saved" }
>;

export type SaveSurveyAnswerOutcome =
  | SavedAnswer
  | { type: "survey-not-found" }
  | { type: "survey-closed" }
  | { type: "survey-question-not-found" }
  | { type: "choice-not-found" }
  | { type: "answer-conflict" }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type SaveSurveyAnswerParams = {
  surveyId: string;
  surveyQuestionId: string;
  choiceId: string;
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: d1.Client;
  at?: Date;
};

type Dependencies = {
  createSession: typeof createLiffSession;
  saveAnswer: typeof d1.action.questionnaire.saveSurveyAnswer;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  saveAnswer: d1.action.questionnaire.saveSurveyAnswer,
};

/** 本人確認結果からAccountを解決し、その本人の1問分の回答だけを保存します。 */
export async function saveSurveyAnswer(
  {
    surveyId,
    surveyQuestionId,
    choiceId,
    idToken,
    lineLoginChannelId,
    db,
    at = new Date(),
  }: SaveSurveyAnswerParams,
  dependencies: Dependencies = defaultDependencies,
): Promise<SaveSurveyAnswerOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") {
    return session;
  }
  return dependencies.saveAnswer(db, {
    accountId: session.session.accountId,
    surveyId,
    surveyQuestionId,
    choiceId,
    at,
  });
}
