import * as v from "valibot";
import { type Question, findQuestionVersion } from "./question";
import {
  CreateSurveyInputSchema,
  PublishSurveyInputSchema,
  SurveyTimestampInputSchema,
  ValidDateSchema,
} from "./schema";
import { type QuestionnaireResult, failure, success, validate } from "./types";

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
  const validated = validate(CreateSurveyInputSchema, input);
  if (!validated.ok) {
    return validated;
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
  const validated = validate(PublishSurveyInputSchema, { survey, catalog, at: publishedAt });
  if (!validated.ok) {
    return validated;
  }
  if (survey.state !== "draft") {
    return failure("invalid-transition", `${survey.state}のSurveyは公開できません`);
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
  return success({
    ...survey,
    state: "published",
    publishedAt: publishedAt.toISOString(),
  });
}

export function withdrawSurvey(survey: Survey, withdrawnAt: Date): QuestionnaireResult<Survey> {
  const validated = validate(SurveyTimestampInputSchema, { survey, at: withdrawnAt });
  if (!validated.ok) {
    return validated;
  }
  if (survey.state !== "published") {
    return failure("invalid-transition", `${survey.state}のSurveyは公開停止できません`);
  }
  return success({
    ...survey,
    state: "withdrawn",
    withdrawnAt: withdrawnAt.toISOString(),
  });
}

export function getSurveyAvailability(survey: Survey, at: Date): SurveyAvailability {
  if (survey.state === "draft" || !v.is(ValidDateSchema, at)) {
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
