import {
  AddQuestionVersionInputSchema,
  CreateQuestionInputSchema,
  QuestionVersionContentSchema,
  QuestionVersionTransitionInputSchema,
} from "./schema";
import { type QuestionnaireResult, failure, success, validate } from "./types";

export type QuestionVersionState = "draft" | "approved" | "retired";

export type Choice = Readonly<{
  id: string;
  label: string;
  /** アイコンや色など、回答の意味には使わない表示用メタデータ。 */
  presentation?: Readonly<Record<string, string>>;
}>;

export type QuestionVersion = Readonly<{
  version: number;
  state: QuestionVersionState;
  text: string;
  hint?: string;
  format: "single_choice";
  choices: readonly [Choice, Choice];
  approvedAt?: string;
  retiredAt?: string;
}>;

export type Question = Readonly<{
  id: string;
  versions: readonly QuestionVersion[];
}>;

export type QuestionVersionContent = {
  text: string;
  hint?: string;
  choices: readonly [Choice, Choice];
};

function cloneChoice(choice: Choice): Choice {
  return {
    id: choice.id,
    label: choice.label,
    ...(choice.presentation ? { presentation: { ...choice.presentation } } : {}),
  };
}

function createDraftVersion(
  version: number,
  content: QuestionVersionContent,
): QuestionnaireResult<QuestionVersion> {
  const validated = validate(QuestionVersionContentSchema, content);
  if (!validated.ok) {
    return validated;
  }
  const [first, second] = content.choices;

  return success({
    version,
    state: "draft",
    text: content.text,
    ...(content.hint !== undefined ? { hint: content.hint } : {}),
    format: "single_choice",
    choices: [cloneChoice(first), cloneChoice(second)],
  });
}

/** 最初のdraft版を持つQuestionを作成します。 */
export function createQuestion(
  id: string,
  content: QuestionVersionContent,
): QuestionnaireResult<Question> {
  const validated = validate(CreateQuestionInputSchema, { id, content });
  if (!validated.ok) {
    return validated;
  }
  const version = createDraftVersion(1, content);
  if (!version.ok) {
    return version;
  }
  return success({ id, versions: [version.value] });
}

/** 既存版を変更せず、次の番号を持つdraft版を追加します。 */
export function addQuestionVersion(
  question: Question,
  content: QuestionVersionContent,
): QuestionnaireResult<Question> {
  const validated = validate(AddQuestionVersionInputSchema, { question, content });
  if (!validated.ok) {
    return validated;
  }
  const nextVersion = Math.max(...question.versions.map(({ version }) => version)) + 1;
  const version = createDraftVersion(nextVersion, content);
  if (!version.ok) {
    return version;
  }
  return success({
    ...question,
    versions: [...question.versions, version.value],
  });
}

function transitionQuestionVersion(
  question: Question,
  versionNumber: number,
  expected: QuestionVersionState,
  next: QuestionVersionState,
  at: Date,
): QuestionnaireResult<Question> {
  const validated = validate(QuestionVersionTransitionInputSchema, {
    question,
    version: versionNumber,
    at,
  });
  if (!validated.ok) {
    return validated;
  }
  const target = question.versions.find((version) => version.version === versionNumber);
  if (!target) {
    return failure("question-version-not-found", "Question Versionが見つかりません");
  }
  if (target.state !== expected) {
    return failure(
      "invalid-transition",
      `Question Versionを${target.state}から${next}へ変更できません`,
    );
  }

  const timestamp = at.toISOString();
  const transitioned: QuestionVersion = {
    ...target,
    state: next,
    ...(next === "approved" ? { approvedAt: timestamp } : {}),
    ...(next === "retired" ? { retiredAt: timestamp } : {}),
  };

  return success({
    ...question,
    versions: question.versions.map((version) =>
      version.version === versionNumber ? transitioned : version,
    ),
  });
}

export function approveQuestionVersion(
  question: Question,
  version: number,
  approvedAt: Date,
): QuestionnaireResult<Question> {
  return transitionQuestionVersion(question, version, "draft", "approved", approvedAt);
}

export function retireQuestionVersion(
  question: Question,
  version: number,
  retiredAt: Date,
): QuestionnaireResult<Question> {
  return transitionQuestionVersion(question, version, "approved", "retired", retiredAt);
}

export function findQuestionVersion(
  question: Question,
  version: number,
): QuestionVersion | undefined {
  return question.versions.find((candidate) => candidate.version === version);
}
