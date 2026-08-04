import * as v from "valibot";
import type {
  DeferredQuestion,
  SurveyAnswer,
  SurveyInteraction,
  SurveyQuestion,
  SwipeDirection,
} from "./model";
import { DeferredQuestionSchema, SurveyAnswerSchema, SwipeDirectionSchema } from "./model";

/**
 * 回答の組み立てと集計。
 *
 * **保存はまだ行いません。** 回答をどこへどの粒度で保存するかは、質問配信・回答保存の
 * サーバー実装とあわせて決めます。ここでは画面が持つ回答の形だけを確定させます。
 */

/** 選んだ方向から、記録する回答を組み立てます。 */
export function createSurveyAnswer(
  question: SurveyQuestion,
  direction: SwipeDirection,
  acceptedAt: Date,
): SurveyAnswer {
  const parsedDirection = v.parse(SwipeDirectionSchema, direction);
  const choice = parsedDirection === "left" ? question.left : question.right;
  return v.parse(SurveyAnswerSchema, {
    kind: "answer",
    surveyQuestionId: question.surveyQuestionId,
    questionId: question.questionId,
    // 回答は、回答した時点の質問の版を指し続けます。
    questionVersion: question.questionVersion,
    choiceId: choice.choiceId,
    direction: parsedDirection,
    acceptedAt: acceptedAt.toISOString(),
  });
}

/** 「あとで回答」の進捗を組み立てます。 */
export function createDeferredQuestion(
  question: SurveyQuestion,
  deferredAt: Date,
): DeferredQuestion {
  return v.parse(DeferredQuestionSchema, {
    kind: "deferred",
    surveyQuestionId: question.surveyQuestionId,
    deferredAt: deferredAt.toISOString(),
  });
}

/** 完了表示で使う内訳。 */
export function summarizeInteractions(interactions: SurveyInteraction[]): {
  answered: number;
  deferred: number;
} {
  return {
    answered: interactions.filter(({ kind }) => kind === "answer").length,
    deferred: interactions.filter(({ kind }) => kind === "deferred").length,
  };
}
