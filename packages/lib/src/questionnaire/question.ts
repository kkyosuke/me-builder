import { type QuestionnaireResult, failure, isNonEmpty, isValidDate, success } from "./types";

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
  if (!Number.isSafeInteger(version) || version < 1) {
    return failure("invalid-input", "Question Versionは1以上の整数である必要があります");
  }
  if (!isNonEmpty(content.text)) {
    return failure("invalid-input", "質問文は空にできません");
  }
  if (content.hint !== undefined && !isNonEmpty(content.hint)) {
    return failure("invalid-input", "補足文を指定する場合は空にできません");
  }

  const [first, second] = content.choices;
  if (
    !isNonEmpty(first.id) ||
    !isNonEmpty(second.id) ||
    !isNonEmpty(first.label) ||
    !isNonEmpty(second.label)
  ) {
    return failure("invalid-input", "ChoiceのIDと表示文言は空にできません");
  }
  if (first.id === second.id) {
    return failure("invalid-input", "Choice IDはQuestion Version内で重複できません");
  }

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
  if (!isNonEmpty(id)) {
    return failure("invalid-input", "Question IDは空にできません");
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
  const nextVersion = Math.max(...question.versions.map((version) => version.version)) + 1;
  const version = createDraftVersion(nextVersion, content);
  if (!version.ok) {
    return version;
  }
  return success({ ...question, versions: [...question.versions, version.value] });
}

function transitionQuestionVersion(
  question: Question,
  versionNumber: number,
  expected: QuestionVersionState,
  next: QuestionVersionState,
  at: Date,
): QuestionnaireResult<Question> {
  if (!isValidDate(at)) {
    return failure("invalid-input", "状態変更時点が不正です");
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
