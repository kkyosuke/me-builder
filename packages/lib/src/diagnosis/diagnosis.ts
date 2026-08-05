import * as v from "valibot";
import { type Question, findQuestionVersion } from "./question";
import {
  CreateDiagnosisInputSchema,
  DiagnosisTimestampInputSchema,
  PublishDiagnosisInputSchema,
  ValidDateSchema,
} from "./schema";
import { type DiagnosisResult, failure, success, validate } from "./types";

export type DiagnosisState = "draft" | "published" | "withdrawn";
export type DiagnosisAvailability = "unavailable" | "before-open" | "open" | "closed" | "withdrawn";

export type DiagnosisQuestion = Readonly<{
  id: string;
  questionId: string;
  questionVersion: number;
  position: number;
}>;

export type Diagnosis = Readonly<{
  id: string;
  title: string;
  description: string;
  opensAt: string;
  closesAt?: string;
  state: DiagnosisState;
  questions: readonly DiagnosisQuestion[];
  publishedAt?: string;
  withdrawnAt?: string;
}>;

export type DiagnosisQuestionInput = {
  id: string;
  questionId: string;
  questionVersion: number;
};

export type CreateDiagnosisInput = {
  id: string;
  title: string;
  description: string;
  opensAt: Date;
  closesAt?: Date;
  questions: readonly DiagnosisQuestionInput[];
};

function findCatalogVersion(catalog: readonly Question[], diagnosisQuestion: DiagnosisQuestion) {
  const question = catalog.find((candidate) => candidate.id === diagnosisQuestion.questionId);
  if (!question) {
    return undefined;
  }
  return findQuestionVersion(question, diagnosisQuestion.questionVersion);
}

/** 順序を固定したdraft Diagnosisを作成します。 */
export function createDiagnosis(input: CreateDiagnosisInput): DiagnosisResult<Diagnosis> {
  const validated = validate(CreateDiagnosisInputSchema, input);
  if (!validated.ok) {
    return validated;
  }
  return success({
    id: input.id,
    title: input.title,
    description: input.description,
    opensAt: input.opensAt.toISOString(),
    ...(input.closesAt ? { closesAt: input.closesAt.toISOString() } : {}),
    state: "draft",
    questions: input.questions.map((question, position) => ({ ...question, position })),
  });
}

/** 参照する全Question Versionがapprovedであることを確認して公開します。 */
export function publishDiagnosis(
  diagnosis: Diagnosis,
  catalog: readonly Question[],
  publishedAt: Date,
): DiagnosisResult<Diagnosis> {
  const validated = validate(PublishDiagnosisInputSchema, { diagnosis, catalog, at: publishedAt });
  if (!validated.ok) {
    return validated;
  }
  if (diagnosis.state !== "draft") {
    return failure("invalid-transition", `${diagnosis.state}のDiagnosisは公開できません`);
  }
  for (const diagnosisQuestion of diagnosis.questions) {
    const version = findCatalogVersion(catalog, diagnosisQuestion);
    if (!version) {
      return failure(
        "question-version-not-found",
        "Diagnosisが参照するQuestion Versionがありません",
      );
    }
    if (version.state !== "approved") {
      return failure(
        "question-version-not-approved",
        "Diagnosis公開時点で全Question Versionがapprovedである必要があります",
      );
    }
  }
  return success({
    ...diagnosis,
    state: "published",
    publishedAt: publishedAt.toISOString(),
  });
}

export function withdrawDiagnosis(
  diagnosis: Diagnosis,
  withdrawnAt: Date,
): DiagnosisResult<Diagnosis> {
  const validated = validate(DiagnosisTimestampInputSchema, { diagnosis, at: withdrawnAt });
  if (!validated.ok) {
    return validated;
  }
  if (diagnosis.state !== "published") {
    return failure("invalid-transition", `${diagnosis.state}のDiagnosisは公開停止できません`);
  }
  return success({
    ...diagnosis,
    state: "withdrawn",
    withdrawnAt: withdrawnAt.toISOString(),
  });
}

export function getDiagnosisAvailability(diagnosis: Diagnosis, at: Date): DiagnosisAvailability {
  if (diagnosis.state === "draft" || !v.is(ValidDateSchema, at)) {
    return "unavailable";
  }
  if (diagnosis.state === "withdrawn") {
    return "withdrawn";
  }
  const timestamp = at.getTime();
  if (timestamp < Date.parse(diagnosis.opensAt)) {
    return "before-open";
  }
  if (diagnosis.closesAt && timestamp >= Date.parse(diagnosis.closesAt)) {
    return "closed";
  }
  return "open";
}

export function findDiagnosisQuestion(
  diagnosis: Diagnosis,
  diagnosisQuestionId: string,
): DiagnosisQuestion | undefined {
  return diagnosis.questions.find((question) => question.id === diagnosisQuestionId);
}

export function findDiagnosisQuestionVersion(
  diagnosisQuestion: DiagnosisQuestion,
  catalog: readonly Question[],
) {
  return findCatalogVersion(catalog, diagnosisQuestion);
}
