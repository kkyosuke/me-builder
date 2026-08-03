import * as v from "valibot";

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

const ChoicesSchema = v.pipe(
  v.tuple([ChoiceSchema, ChoiceSchema]),
  v.check(([first, second]) => first.id !== second.id, "Choice IDは重複できません"),
);

export const QuestionVersionContentSchema = v.object({
  text: NonEmptyStringSchema,
  hint: v.optional(NonEmptyStringSchema),
  choices: ChoicesSchema,
});

export const QuestionVersionSchema = v.object({
  version: PositiveIntegerSchema,
  state: v.picklist(["draft", "approved", "retired"]),
  text: NonEmptyStringSchema,
  hint: v.optional(NonEmptyStringSchema),
  format: v.literal("single_choice"),
  choices: ChoicesSchema,
  approvedAt: v.optional(TimestampSchema),
  retiredAt: v.optional(TimestampSchema),
});

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

export const SurveyQuestionInputSchema = v.object({
  id: NonEmptyStringSchema,
  questionId: NonEmptyStringSchema,
  questionVersion: PositiveIntegerSchema,
});

export const CreateSurveyInputSchema = v.pipe(
  v.object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    opensAt: ValidDateSchema,
    closesAt: v.optional(ValidDateSchema),
    questions: v.pipe(v.array(SurveyQuestionInputSchema), v.minLength(1)),
  }),
  v.check(
    ({ opensAt, closesAt }) => !closesAt || closesAt.getTime() > opensAt.getTime(),
    "受付終了時点は受付開始時点より後にしてください",
  ),
  v.check(
    ({ questions }) => new Set(questions.map(({ id }) => id)).size === questions.length,
    "Survey Question IDは重複できません",
  ),
  v.check(
    ({ questions }) =>
      new Set(questions.map(({ questionId }) => questionId)).size === questions.length,
    "同じQuestionを1つのSurveyへ重複して追加できません",
  ),
);

export const SurveyQuestionSchema = v.object({
  id: NonEmptyStringSchema,
  questionId: NonEmptyStringSchema,
  questionVersion: PositiveIntegerSchema,
  position: NonNegativeIntegerSchema,
});

export const SurveySchema = v.pipe(
  v.object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    opensAt: TimestampSchema,
    closesAt: v.optional(TimestampSchema),
    state: v.picklist(["draft", "published", "withdrawn"]),
    questions: v.pipe(v.array(SurveyQuestionSchema), v.minLength(1)),
    publishedAt: v.optional(TimestampSchema),
    withdrawnAt: v.optional(TimestampSchema),
  }),
  v.check(
    ({ opensAt, closesAt }) => !closesAt || Date.parse(closesAt) > Date.parse(opensAt),
    "受付終了時点は受付開始時点より後にしてください",
  ),
  v.check(
    ({ questions }) => new Set(questions.map(({ id }) => id)).size === questions.length,
    "Survey Question IDは重複できません",
  ),
  v.check(
    ({ questions }) =>
      new Set(questions.map(({ questionId }) => questionId)).size === questions.length,
    "同じQuestionを1つのSurveyへ重複して追加できません",
  ),
  v.check(
    ({ questions }) => questions.every(({ position }, index) => position === index),
    "Survey Questionの表示順は0から連続させてください",
  ),
);

export const SurveyTimestampInputSchema = v.object({
  survey: SurveySchema,
  at: ValidDateSchema,
});

export const PublishSurveyInputSchema = v.object({
  survey: SurveySchema,
  catalog: v.array(QuestionSchema),
  at: ValidDateSchema,
});

export const RespondentSchema = v.object({
  accountId: NonEmptyStringSchema,
  status: v.picklist(["active", "inactive"]),
});

export const AnswerSchema = v.object({
  surveyQuestionId: NonEmptyStringSchema,
  questionId: NonEmptyStringSchema,
  questionVersion: PositiveIntegerSchema,
  choiceId: NonEmptyStringSchema,
  acceptedAt: TimestampSchema,
  sourceRecordId: NonEmptyStringSchema,
});

export const DeferredQuestionSchema = v.object({
  surveyQuestionId: NonEmptyStringSchema,
  deferredAt: TimestampSchema,
});

export const SurveyResponseSchema = v.pipe(
  v.object({
    id: NonEmptyStringSchema,
    accountId: NonEmptyStringSchema,
    surveyId: NonEmptyStringSchema,
    answers: v.array(AnswerSchema),
    deferredQuestions: v.array(DeferredQuestionSchema),
  }),
  v.check(
    ({ answers }) =>
      new Set(answers.map(({ surveyQuestionId }) => surveyQuestionId)).size === answers.length,
    "Survey Questionごとの現在回答は1件だけ保持できます",
  ),
  v.check(
    ({ deferredQuestions }) =>
      new Set(deferredQuestions.map(({ surveyQuestionId }) => surveyQuestionId)).size ===
      deferredQuestions.length,
    "Survey Questionごとの延期記録は1件だけ保持できます",
  ),
  v.check(({ answers, deferredQuestions }) => {
    const answered = new Set(answers.map(({ surveyQuestionId }) => surveyQuestionId));
    return deferredQuestions.every(({ surveyQuestionId }) => !answered.has(surveyQuestionId));
  }, "回答済みのSurvey Questionは延期状態にできません"),
);

const SurveyInteractionEntries = {
  response: v.optional(SurveyResponseSchema),
  responseId: v.optional(NonEmptyStringSchema),
  survey: SurveySchema,
  respondent: RespondentSchema,
  surveyQuestionId: NonEmptyStringSchema,
  at: ValidDateSchema,
};

export const SurveyInteractionInputSchema = v.pipe(
  v.object(SurveyInteractionEntries),
  v.check(
    ({ response, responseId }) => response !== undefined || responseId !== undefined,
    "最初の操作にはResponse IDが必要です",
  ),
);

export const RecordSurveyAnswerInputSchema = v.pipe(
  v.object({
    ...SurveyInteractionEntries,
    catalog: v.array(QuestionSchema),
    choiceId: NonEmptyStringSchema,
    sourceRecordId: NonEmptyStringSchema,
  }),
  v.check(
    ({ response, responseId }) => response !== undefined || responseId !== undefined,
    "最初の操作にはResponse IDが必要です",
  ),
);
