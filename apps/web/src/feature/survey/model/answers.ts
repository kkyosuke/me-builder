import * as v from "valibot";
import type { SurveyResultAnswer } from "./survey-result";
import type {
  DeferredQuestion,
  SurveyAnswer,
  SurveyInteraction,
  SurveyQuestion,
  SwipeDirection,
} from "./types";
import { DeferredQuestionSchema, SurveyAnswerSchema, SwipeDirectionSchema } from "./types";

/**
 * 回答の組み立てと集計。
 *
 * 保存処理そのものはinfrastructure層へ委譲し、ここでは画面が送受信する回答の形だけを
 * 組み立てます。
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

/** 保存済み回答を回答画面の状態へ戻し、未回答の質問だけを表示順で返します。 */
export function restoreSurveyProgress(
  questions: SurveyQuestion[],
  savedAnswers: SurveyResultAnswer[],
): { answers: SurveyAnswer[]; unansweredQuestions: SurveyQuestion[] } {
  const savedBySurveyQuestionId = new Map(
    savedAnswers.map((answer) => [answer.surveyQuestionId, answer]),
  );
  if (savedBySurveyQuestionId.size !== savedAnswers.length) {
    throw new Error("保存済み回答に同じ質問が重複しています。");
  }

  const answers: SurveyAnswer[] = [];
  const unansweredQuestions: SurveyQuestion[] = [];
  for (const question of questions) {
    const saved = savedBySurveyQuestionId.get(question.surveyQuestionId);
    if (!saved) {
      unansweredQuestions.push(question);
      continue;
    }
    if (
      saved.questionId !== question.questionId ||
      saved.questionVersion !== question.questionVersion
    ) {
      throw new Error("保存済み回答と配信中の質問の版が一致しません。");
    }
    const direction =
      saved.choiceId === question.left.choiceId
        ? "left"
        : saved.choiceId === question.right.choiceId
          ? "right"
          : undefined;
    if (!direction) {
      throw new Error("保存済み回答の選択肢が配信中の質問にありません。");
    }
    answers.push(
      v.parse(SurveyAnswerSchema, {
        kind: "answer",
        surveyQuestionId: saved.surveyQuestionId,
        questionId: saved.questionId,
        questionVersion: saved.questionVersion,
        choiceId: saved.choiceId,
        direction,
        acceptedAt: saved.acceptedAt,
      }),
    );
  }

  if (answers.length !== savedAnswers.length) {
    throw new Error("保存済み回答に配信対象外の質問が含まれています。");
  }
  return { answers, unansweredQuestions };
}
