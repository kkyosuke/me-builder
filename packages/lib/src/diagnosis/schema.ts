import * as v from "valibot";
import { LIKERT_5_LABELS } from "./question-format";

export const NonEmptyStringSchema = v.pipe(
  v.string(),
  v.check((value) => value.trim().length > 0, "空文字は指定できません"),
);

export const ValidDateSchema = v.pipe(
  v.date(),
  v.check((value) => !Number.isNaN(value.getTime()), "有効な日時を指定してください"),
);

const PositiveIntegerSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(1));
const NonNegativeIntegerSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const TimestampSchema = v.pipe(v.string(), v.isoTimestamp());

export const ChoiceSchema = v.object({
  id: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  presentation: v.optional(v.record(v.string(), v.string())),
});

const SingleChoicesSchema = v.pipe(
  v.tuple([ChoiceSchema, ChoiceSchema]),
  v.check(([first, second]) => first.id !== second.id, "Choice IDは重複できません"),
);

const Likert5ChoicesSchema = v.pipe(
  v.tuple([ChoiceSchema, ChoiceSchema, ChoiceSchema, ChoiceSchema, ChoiceSchema]),
  v.check(
    (choices) => new Set(choices.map(({ id }) => id)).size === choices.length,
    "Choice IDは重複できません",
  ),
  v.check(
    (choices) => choices.every(({ label }, index) => label === LIKERT_5_LABELS[index]),
    "5段階尺度は固定された表示順を使用してください",
  ),
);

export const QuestionVersionContentSchema = v.union([
  v.object({
    text: NonEmptyStringSchema,
    hint: v.optional(NonEmptyStringSchema),
    format: v.optional(v.literal("single_choice")),
    choices: SingleChoicesSchema,
  }),
  v.object({
    text: NonEmptyStringSchema,
    hint: v.optional(NonEmptyStringSchema),
    format: v.literal("likert_5"),
    choices: Likert5ChoicesSchema,
  }),
]);

const QuestionVersionBase = {
  version: PositiveIntegerSchema,
  state: v.picklist(["draft", "approved", "retired"]),
  text: NonEmptyStringSchema,
  hint: v.optional(NonEmptyStringSchema),
  approvedAt: v.optional(TimestampSchema),
  retiredAt: v.optional(TimestampSchema),
};

export const QuestionVersionSchema = v.variant("format", [
  v.object({
    ...QuestionVersionBase,
    format: v.literal("single_choice"),
    choices: SingleChoicesSchema,
  }),
  v.object({
    ...QuestionVersionBase,
    format: v.literal("likert_5"),
    choices: Likert5ChoicesSchema,
  }),
]);

export const QuestionSchema = v.pipe(
  v.object({
    id: NonEmptyStringSchema,
    versions: v.pipe(v.array(QuestionVersionSchema), v.minLength(1)),
  }),
  v.check(
    ({ versions }) => new Set(versions.map(({ version }) => version)).size === versions.length,
    "Question Versionは重複できません",
  ),
);

export const CreateQuestionInputSchema = v.object({
  id: NonEmptyStringSchema,
  content: QuestionVersionContentSchema,
});

export const AddQuestionVersionInputSchema = v.object({
  question: QuestionSchema,
  content: QuestionVersionContentSchema,
});

export const QuestionVersionTransitionInputSchema = v.object({
  question: QuestionSchema,
  version: PositiveIntegerSchema,
  at: ValidDateSchema,
});

export const DiagnosisQuestionInputSchema = v.object({
  id: NonEmptyStringSchema,
  questionId: NonEmptyStringSchema,
  questionVersion: PositiveIntegerSchema,
});

export const CreateDiagnosisInputSchema = v.pipe(
  v.object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    opensAt: ValidDateSchema,
    closesAt: v.optional(ValidDateSchema),
    questions: v.pipe(v.array(DiagnosisQuestionInputSchema), v.minLength(1)),
  }),
  v.check(
    ({ opensAt, closesAt }) => !closesAt || closesAt.getTime() > opensAt.getTime(),
    "受付終了時点は受付開始時点より後にしてください",
  ),
  v.check(
    ({ questions }) => new Set(questions.map(({ id }) => id)).size === questions.length,
    "Diagnosis Question IDは重複できません",
  ),
  v.check(
    ({ questions }) =>
      new Set(questions.map(({ questionId }) => questionId)).size === questions.length,
    "同じQuestionを1つのDiagnosisへ重複して追加できません",
  ),
);

export const DiagnosisQuestionSchema = v.object({
  id: NonEmptyStringSchema,
  questionId: NonEmptyStringSchema,
  questionVersion: PositiveIntegerSchema,
  position: NonNegativeIntegerSchema,
});

export const DiagnosisSchema = v.pipe(
  v.object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    opensAt: TimestampSchema,
    closesAt: v.optional(TimestampSchema),
    state: v.picklist(["draft", "published", "withdrawn"]),
    questions: v.pipe(v.array(DiagnosisQuestionSchema), v.minLength(1)),
    publishedAt: v.optional(TimestampSchema),
    withdrawnAt: v.optional(TimestampSchema),
  }),
  v.check(
    ({ opensAt, closesAt }) => !closesAt || Date.parse(closesAt) > Date.parse(opensAt),
    "受付終了時点は受付開始時点より後にしてください",
  ),
  v.check(
    ({ questions }) => new Set(questions.map(({ id }) => id)).size === questions.length,
    "Diagnosis Question IDは重複できません",
  ),
  v.check(
    ({ questions }) =>
      new Set(questions.map(({ questionId }) => questionId)).size === questions.length,
    "同じQuestionを1つのDiagnosisへ重複して追加できません",
  ),
  v.check(
    ({ questions }) => questions.every(({ position }, index) => position === index),
    "Diagnosis Questionの表示順は0から連続させてください",
  ),
);

export const DiagnosisTimestampInputSchema = v.object({
  diagnosis: DiagnosisSchema,
  at: ValidDateSchema,
});

export const PublishDiagnosisInputSchema = v.object({
  diagnosis: DiagnosisSchema,
  catalog: v.array(QuestionSchema),
  at: ValidDateSchema,
});

export const RespondentSchema = v.object({
  accountId: NonEmptyStringSchema,
  status: v.picklist(["active", "inactive"]),
});

export const AnswerSchema = v.object({
  diagnosisQuestionId: NonEmptyStringSchema,
  questionId: NonEmptyStringSchema,
  questionVersion: PositiveIntegerSchema,
  choiceId: NonEmptyStringSchema,
  acceptedAt: TimestampSchema,
  sourceRecordId: NonEmptyStringSchema,
});

export const DeferredQuestionSchema = v.object({
  diagnosisQuestionId: NonEmptyStringSchema,
  deferredAt: TimestampSchema,
});

export const DiagnosisResponseSchema = v.pipe(
  v.object({
    id: NonEmptyStringSchema,
    accountId: NonEmptyStringSchema,
    diagnosisId: NonEmptyStringSchema,
    answers: v.array(AnswerSchema),
    deferredQuestions: v.array(DeferredQuestionSchema),
  }),
  v.check(
    ({ answers }) =>
      new Set(answers.map(({ diagnosisQuestionId }) => diagnosisQuestionId)).size ===
      answers.length,
    "Diagnosis Questionごとの現在回答は1件だけ保持できます",
  ),
  v.check(
    ({ deferredQuestions }) =>
      new Set(deferredQuestions.map(({ diagnosisQuestionId }) => diagnosisQuestionId)).size ===
      deferredQuestions.length,
    "Diagnosis Questionごとの延期記録は1件だけ保持できます",
  ),
  v.check(({ answers, deferredQuestions }) => {
    const answered = new Set(answers.map(({ diagnosisQuestionId }) => diagnosisQuestionId));
    return deferredQuestions.every(({ diagnosisQuestionId }) => !answered.has(diagnosisQuestionId));
  }, "回答済みのDiagnosis Questionは延期状態にできません"),
);

const DiagnosisInteractionEntries = {
  response: v.optional(DiagnosisResponseSchema),
  responseId: v.optional(NonEmptyStringSchema),
  diagnosis: DiagnosisSchema,
  respondent: RespondentSchema,
  diagnosisQuestionId: NonEmptyStringSchema,
  at: ValidDateSchema,
};

export const DiagnosisInteractionInputSchema = v.pipe(
  v.object(DiagnosisInteractionEntries),
  v.check(
    ({ response, responseId }) => response !== undefined || responseId !== undefined,
    "最初の操作にはResponse IDが必要です",
  ),
);

export const RecordDiagnosisAnswerInputSchema = v.pipe(
  v.object({
    ...DiagnosisInteractionEntries,
    catalog: v.array(QuestionSchema),
    choiceId: NonEmptyStringSchema,
    sourceRecordId: NonEmptyStringSchema,
  }),
  v.check(
    ({ response, responseId }) => response !== undefined || responseId !== undefined,
    "最初の操作にはResponse IDが必要です",
  ),
);
