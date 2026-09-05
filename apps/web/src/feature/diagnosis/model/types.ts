import * as v from "valibot";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const PositiveIntegerSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(1));
const TimestampSchema = v.pipe(v.string(), v.isoTimestamp());

/** スワイプの方向。左右の2択に対応します。 */
export const SwipeDirectionSchema = v.picklist(["left", "right"]);

const DiagnosisChoiceSchema = v.object({
  choiceId: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  score: v.optional(v.nullable(v.number())),
});

/** 1問1画面で表示する質問。 */
const SingleChoiceQuestionSchema = v.pipe(
  v.object({
    diagnosisQuestionId: NonEmptyStringSchema,
    questionId: NonEmptyStringSchema,
    questionVersion: PositiveIntegerSchema,
    text: NonEmptyStringSchema,
    hint: v.optional(NonEmptyStringSchema),
    backsideOfDiagnosisQuestionId: v.optional(NonEmptyStringSchema),
    format: v.optional(v.literal("single_choice")),
    left: DiagnosisChoiceSchema,
    right: DiagnosisChoiceSchema,
  }),
  v.check(({ left, right }) => left.choiceId !== right.choiceId, "左右のChoice IDは重複できません"),
);

const Likert5QuestionSchema = v.object({
  diagnosisQuestionId: NonEmptyStringSchema,
  questionId: NonEmptyStringSchema,
  questionVersion: PositiveIntegerSchema,
  text: NonEmptyStringSchema,
  hint: v.optional(NonEmptyStringSchema),
  format: v.literal("likert_5"),
  choices: v.tuple([
    DiagnosisChoiceSchema,
    DiagnosisChoiceSchema,
    DiagnosisChoiceSchema,
    DiagnosisChoiceSchema,
    DiagnosisChoiceSchema,
  ]),
});

export const DiagnosisQuestionSchema = v.union([SingleChoiceQuestionSchema, Likert5QuestionSchema]);

export const DiagnosisAnswerSchema = v.object({
  kind: v.literal("answer"),
  diagnosisQuestionId: NonEmptyStringSchema,
  questionId: NonEmptyStringSchema,
  questionVersion: PositiveIntegerSchema,
  choiceId: NonEmptyStringSchema,
  direction: v.optional(SwipeDirectionSchema),
  acceptedAt: TimestampSchema,
});

export const DeferredQuestionSchema = v.object({
  kind: v.literal("deferred"),
  diagnosisQuestionId: NonEmptyStringSchema,
  deferredAt: TimestampSchema,
});

const DiagnosisInteractionSchema = v.variant("kind", [
  DiagnosisAnswerSchema,
  DeferredQuestionSchema,
]);
export const DiagnosisQuestionsSchema = v.array(DiagnosisQuestionSchema);

export type SwipeDirection = v.InferOutput<typeof SwipeDirectionSchema>;
export type DiagnosisQuestion = v.InferOutput<typeof DiagnosisQuestionSchema>;
export type DiagnosisAnswer = v.InferOutput<typeof DiagnosisAnswerSchema>;
export type DeferredQuestion = v.InferOutput<typeof DeferredQuestionSchema>;
export type DiagnosisInteraction = v.InferOutput<typeof DiagnosisInteractionSchema>;
