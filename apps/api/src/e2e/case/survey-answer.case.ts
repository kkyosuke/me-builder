import type { E2eCase } from "./e2e-case";

// 正式なAPI契約は docs/development/questionnaire-api.md を参照する。
export const surveyAnswerCases = {
  createAndProgress: {
    id: "ANSWER-001",
    name: "初回回答を保存し一覧の進捗へ反映すること",
    in: {
      method: "PUT",
      path: "/api/surveys/relationship-priority/answers/sq-relationship-priority-01",
      authorization: "Bearer known-token",
      setup: ["migrationとquestionnaire seedを適用", "body: choiceId=yes"],
    },
    out: {
      status: 200,
      body: {
        outcome: "created",
        progress: { responseStatus: "in-progress", answeredCount: 1, questionCount: 10 },
        list: { responseStatus: "in-progress", answeredCount: 1 },
      },
    },
  },
  idempotentRetry: {
    id: "ANSWER-002",
    name: "同じChoiceの再送で重複行を作らないこと",
    in: {
      method: "PUT",
      path: "/api/surveys/relationship-priority/answers/sq-relationship-priority-01",
      authorization: "Bearer known-token",
      setup: ["同じパスとchoiceId=yesを並行して2回送信"],
    },
    out: {
      status: 200,
      body: {
        outcomes: ["created", "unchanged"],
        persistedCounts: { surveyResponses: 1, sourceRecords: 1, surveyAnswers: 1 },
      },
    },
  },
  rejectChange: {
    id: "ANSWER-003",
    name: "異なるChoiceへの変更を409にして既存回答を維持すること",
    in: {
      method: "PUT",
      path: "/api/surveys/relationship-priority/answers/sq-relationship-priority-01",
      authorization: "Bearer known-token",
      setup: ["choiceId=yesを保存後、同じパスへchoiceId=noを送信"],
    },
    out: {
      status: 409,
      body: {
        error: "Answer already exists",
        reason: "answer_change_requires_revision",
      },
    },
  },
  complete: {
    id: "ANSWER-004",
    name: "全問保存後に一覧の進捗をansweredへ反映すること",
    in: {
      method: "PUT",
      path: "/api/surveys/relationship-priority/answers/{surveyQuestionId}",
      authorization: "Bearer known-token",
      setup: ["relationship-priorityの10問すべてへchoiceId=yesを送信"],
    },
    out: {
      status: 200,
      body: {
        progress: { responseStatus: "answered", answeredCount: 10, questionCount: 10 },
        list: { responseStatus: "answered", answeredCount: 10 },
      },
    },
  },
  getContents: {
    id: "ANSWER-005",
    name: "保存済み回答を質問文と選択肢ラベル付きで取得すること",
    in: {
      method: "GET",
      path: "/api/surveys/relationship-priority/answers",
      authorization: "Bearer known-token",
      setup: ["1問目へchoiceId=yes、2問目へchoiceId=noを保存"],
    },
    out: {
      status: 200,
      body: {
        responseStatus: "in-progress",
        answeredCount: 2,
        questionCount: 10,
        answers: [
          { surveyQuestionId: "sq-relationship-priority-01", choiceLabel: "はい" },
          { surveyQuestionId: "sq-relationship-priority-02", choiceLabel: "いいえ" },
        ],
      },
    },
  },
  missingContents: {
    id: "ANSWER-006",
    name: "本人の回答がない場合は回答内容を返さないこと",
    in: {
      method: "GET",
      path: "/api/surveys/relationship-priority/answers",
      authorization: "Bearer known-token",
      setup: ["回答を保存しない"],
    },
    out: {
      status: 404,
      body: {
        error: "Survey answers not found",
        reason: "survey_answers_not_found",
      },
    },
  },
} as const satisfies Readonly<Record<string, E2eCase>>;
