import * as v from "valibot";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const PositiveIntegerSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(1));
const TimestampSchema = v.pipe(v.string(), v.isoTimestamp());

/** カードへ表示するアイコンの識別子。 */
const SurveyIconNameSchema = v.picklist([
  "house",
  "mountain",
  "book",
  "zap",
  "user",
  "users",
  "sun",
  "moon",
  "leaf",
  "music",
  "heart",
  "calculator",
  "coffee",
  "clock",
  "circle-check",
  "circle-x",
]);

/** スワイプの方向。左右の2択に対応します。 */
export const SwipeDirectionSchema = v.picklist(["left", "right"]);

const SurveyChoiceSchema = v.object({
  choiceId: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  icon: SurveyIconNameSchema,
});

/** 1問1画面で表示する質問。 */
export const SurveyQuestionSchema = v.pipe(
  v.object({
    surveyQuestionId: NonEmptyStringSchema,
    questionId: NonEmptyStringSchema,
    questionVersion: PositiveIntegerSchema,
    text: NonEmptyStringSchema,
    hint: v.optional(NonEmptyStringSchema),
    left: SurveyChoiceSchema,
    right: SurveyChoiceSchema,
  }),
  v.check(({ left, right }) => left.choiceId !== right.choiceId, "左右のChoice IDは重複できません"),
);

export const SurveyAnswerSchema = v.object({
  kind: v.literal("answer"),
  surveyQuestionId: NonEmptyStringSchema,
  questionId: NonEmptyStringSchema,
  questionVersion: PositiveIntegerSchema,
  choiceId: NonEmptyStringSchema,
  direction: SwipeDirectionSchema,
  acceptedAt: TimestampSchema,
});

export const DeferredQuestionSchema = v.object({
  kind: v.literal("deferred"),
  surveyQuestionId: NonEmptyStringSchema,
  deferredAt: TimestampSchema,
});

const SurveyInteractionSchema = v.variant("kind", [SurveyAnswerSchema, DeferredQuestionSchema]);
export const SurveyQuestionsSchema = v.array(SurveyQuestionSchema);

export type SurveyIconName = v.InferOutput<typeof SurveyIconNameSchema>;
export type SwipeDirection = v.InferOutput<typeof SwipeDirectionSchema>;
export type SurveyQuestion = v.InferOutput<typeof SurveyQuestionSchema>;
export type SurveyAnswer = v.InferOutput<typeof SurveyAnswerSchema>;
export type DeferredQuestion = v.InferOutput<typeof DeferredQuestionSchema>;
export type SurveyInteraction = v.InferOutput<typeof SurveyInteractionSchema>;
