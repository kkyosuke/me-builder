import type { SurveyAnswer, SurveyQuestion, SwipeDirection } from "./types";

/**
 * 回答の組み立てと集計。
 *
 * **保存はまだ行いません。** 回答をどこへどの粒度で保存するかは、質問配信・回答保存の
 * サーバー実装とあわせて決めます。ここでは画面が持つ回答の形だけを確定させます。
 */

/** 選んだ方向から、記録する回答を組み立てます。 */
export function createChoiceAnswer(
  question: SurveyQuestion,
  direction: SwipeDirection,
  answeredAt: Date,
): SurveyAnswer {
  const choice = direction === "left" ? question.left : question.right;
  return {
    kind: "choice",
    questionId: question.id,
    // 回答は、回答した時点の質問の版を指し続けます。
    questionVersion: question.version,
    value: choice.value,
    direction,
    answeredAt: answeredAt.toISOString(),
  };
}

/** スキップ（あとで回答）を記録する回答を組み立てます。 */
export function createSkipAnswer(question: SurveyQuestion, answeredAt: Date): SurveyAnswer {
  return {
    kind: "skipped",
    questionId: question.id,
    questionVersion: question.version,
    answeredAt: answeredAt.toISOString(),
  };
}

/** 完了表示で使う内訳。 */
export function summarizeAnswers(answers: SurveyAnswer[]): { answered: number; skipped: number } {
  return {
    answered: answers.filter((answer) => answer.kind === "choice").length,
    skipped: answers.filter((answer) => answer.kind === "skipped").length,
  };
}
