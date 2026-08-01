import { type Question, findQuestionVersion } from "./question";
import { type QuestionnaireResult, failure, isNonEmpty, isValidDate, success } from "./types";

export type SurveyState = "draft" | "published" | "withdrawn";
export type SurveyAvailability = "unavailable" | "before-open" | "open" | "closed" | "withdrawn";

export type SurveyQuestion = Readonly<{
  id: string;
  questionId: string;
  questionVersion: number;
  position: number;
}>;

export type Survey = Readonly<{
  id: string;
  title: string;
  opensAt: string;
  closesAt?: string;
  state: SurveyState;
  questions: readonly SurveyQuestion[];
  publishedAt?: string;
  withdrawnAt?: string;
}>;

export type SurveyQuestionInput = {
  id: string;
  questionId: string;
  questionVersion: number;
};

export type CreateSurveyInput = {
  id: string;
  title: string;
  opensAt: Date;
  closesAt?: Date;
  questions: readonly SurveyQuestionInput[];
};

function findCatalogVersion(catalog: readonly Question[], surveyQuestion: SurveyQuestion) {
  const question = catalog.find((candidate) => candidate.id === surveyQuestion.questionId);
  if (!question) {
    return undefined;
  }
  return findQuestionVersion(question, surveyQuestion.questionVersion);
}

/** 順序を固定したdraft Surveyを作成します。 */
export function createSurvey(input: CreateSurveyInput): QuestionnaireResult<Survey> {
  if (!isNonEmpty(input.id) || !isNonEmpty(input.title)) {
    return failure("invalid-input", "SurveyのIDとタイトルは空にできません");
  }
  if (!isValidDate(input.opensAt) || (input.closesAt && !isValidDate(input.closesAt))) {
    return failure("invalid-input", "Surveyの受付期間が不正です");
  }
  if (input.closesAt && input.closesAt.getTime() <= input.opensAt.getTime()) {
    return failure("invalid-input", "受付終了時点は受付開始時点より後にしてください");
  }
  if (input.questions.length === 0) {
    return failure("invalid-input", "Surveyには1件以上の質問が必要です");
  }

  const surveyQuestionIds = new Set<string>();
  const questionIds = new Set<string>();
  for (const question of input.questions) {
    if (!isNonEmpty(question.id) || !isNonEmpty(question.questionId)) {
      return failure("invalid-input", "Survey QuestionのIDは空にできません");
    }
    if (!Number.isSafeInteger(question.questionVersion) || question.questionVersion < 1) {
      return failure("invalid-input", "Question Versionは1以上の整数である必要があります");
    }
    if (surveyQuestionIds.has(question.id)) {
      return failure("invalid-input", "Survey Question IDは重複できません");
    }
    if (questionIds.has(question.questionId)) {
      return failure("invalid-input", "同じQuestionを1つのSurveyへ重複して追加できません");
    }
    surveyQuestionIds.add(question.id);
    questionIds.add(question.questionId);
  }

  return success({
    id: input.id,
    title: input.title,
    opensAt: input.opensAt.toISOString(),
    ...(input.closesAt ? { closesAt: input.closesAt.toISOString() } : {}),
    state: "draft",
    questions: input.questions.map((question, position) => ({ ...question, position })),
  });
}

/** 参照する全Question Versionがapprovedであることを確認して公開します。 */
export function publishSurvey(
  survey: Survey,
  catalog: readonly Question[],
  publishedAt: Date,
): QuestionnaireResult<Survey> {
  if (survey.state !== "draft") {
    return failure("invalid-transition", `${survey.state}のSurveyは公開できません`);
  }
  if (!isValidDate(publishedAt)) {
    return failure("invalid-input", "公開時点が不正です");
  }
  for (const surveyQuestion of survey.questions) {
    const version = findCatalogVersion(catalog, surveyQuestion);
    if (!version) {
      return failure("question-version-not-found", "Surveyが参照するQuestion Versionがありません");
    }
    if (version.state !== "approved") {
      return failure(
        "question-version-not-approved",
        "Survey公開時点で全Question Versionがapprovedである必要があります",
      );
    }
  }
  return success({ ...survey, state: "published", publishedAt: publishedAt.toISOString() });
}

export function withdrawSurvey(survey: Survey, withdrawnAt: Date): QuestionnaireResult<Survey> {
  if (survey.state !== "published") {
    return failure("invalid-transition", `${survey.state}のSurveyは公開停止できません`);
  }
  if (!isValidDate(withdrawnAt)) {
    return failure("invalid-input", "公開停止時点が不正です");
  }
  return success({ ...survey, state: "withdrawn", withdrawnAt: withdrawnAt.toISOString() });
}

export function getSurveyAvailability(survey: Survey, at: Date): SurveyAvailability {
  if (survey.state === "draft" || !isValidDate(at)) {
    return "unavailable";
  }
  if (survey.state === "withdrawn") {
    return "withdrawn";
  }
  const timestamp = at.getTime();
  if (timestamp < Date.parse(survey.opensAt)) {
    return "before-open";
  }
  if (survey.closesAt && timestamp >= Date.parse(survey.closesAt)) {
    return "closed";
  }
  return "open";
}

export function findSurveyQuestion(
  survey: Survey,
  surveyQuestionId: string,
): SurveyQuestion | undefined {
  return survey.questions.find((question) => question.id === surveyQuestionId);
}

export function findSurveyQuestionVersion(
  surveyQuestion: SurveyQuestion,
  catalog: readonly Question[],
) {
  return findCatalogVersion(catalog, surveyQuestion);
}
