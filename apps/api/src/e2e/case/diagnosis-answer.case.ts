import type { E2eCase } from "./e2e-case";

// 正式なAPI契約は docs/development/diagnosis-api.md を参照する。
export const diagnosisAnswerCases = {
  createAndProgress: {
    id: "ANSWER-001",
    name: "初回回答を保存し一覧の進捗へ反映すること",
    in: {
      method: "PUT",
      path: "/api/diagnoses/relationship-priority/answers/dq-relationship-priority-01",
      session: "known-token",
      setup: ["migrationとdiagnosis seedを適用", "body: choiceId=yes"],
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
      path: "/api/diagnoses/relationship-priority/answers/dq-relationship-priority-01",
      session: "known-token",
      setup: ["同じパスとchoiceId=yesを並行して2回送信"],
    },
    out: {
      status: 200,
      body: {
        outcomes: ["created", "unchanged"],
        persistedCounts: { diagnosisResponses: 1, sourceRecords: 1, diagnosisAnswers: 1 },
      },
    },
  },
  rejectChange: {
    id: "ANSWER-003",
    name: "異なるChoiceへの変更を409にして既存回答を維持すること",
    in: {
      method: "PUT",
      path: "/api/diagnoses/relationship-priority/answers/dq-relationship-priority-01",
      session: "known-token",
      setup: ["choiceId=yesを保存後、同じパスへchoiceId=noを送信"],
    },
    out: {
      status: 409,
      body: {
        error: "Answer already exists",
        reason: "answer_is_immutable",
      },
    },
  },
  complete: {
    id: "ANSWER-004",
    name: "全問保存後に一覧の進捗をansweredへ反映すること",
    in: {
      method: "PUT",
      path: "/api/diagnoses/relationship-priority/answers/{diagnosisQuestionId}",
      session: "known-token",
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
    name: "保存済み回答を質問文・選択肢ラベル・計算済み傾向付きで取得すること",
    in: {
      method: "GET",
      path: "/api/diagnoses/relationship-priority/answers",
      session: "known-token",
      setup: ["1問目へchoiceId=yes、2問目へchoiceId=noを保存"],
    },
    out: {
      status: 200,
      body: {
        responseStatus: "in-progress",
        answeredCount: 2,
        questionCount: 10,
        answers: [
          { diagnosisQuestionId: "dq-relationship-priority-01", choiceLabel: "はい" },
          { diagnosisQuestionId: "dq-relationship-priority-02", choiceLabel: "いいえ" },
        ],
        scoring: { scoringVersion: 1, parameterCount: 4 },
      },
    },
  },
  missingContents: {
    id: "ANSWER-006",
    name: "本人の回答がない場合は回答内容を返さないこと",
    in: {
      method: "GET",
      path: "/api/diagnoses/relationship-priority/answers",
      session: "known-token",
      setup: ["回答を保存しない"],
    },
    out: {
      status: 404,
      body: {
        error: "Diagnosis answers not found",
        reason: "diagnosis_answers_not_found",
      },
    },
  },
  resetDevelopmentData: {
    id: "ANSWER-007",
    name: "test環境で本人の診断・日記・Brain・まとめを全削除すること",
    in: {
      method: "DELETE",
      path: "/api/dev/account-data",
      session: "known-token",
      setup: ["2問分の回答、日記、Brain Item、わたしのまとめを保存", "ENVIRONMENT=test"],
    },
    out: {
      status: 200,
      body: {
        deletedDiagnosisResponseCount: 1,
        deletedConversationSessionCount: 1,
        deletedSourceRecordCount: 3,
        deletedBrainItemCount: 1,
        deletedProfileSummaryVersionCount: 1,
        scheduledVectorDeletionCount: 1,
        list: { responseStatus: "unanswered", answeredCount: 0 },
      },
    },
  },
  rejectProductionReset: {
    id: "ANSWER-008",
    name: "production環境では回答データを削除しないこと",
    in: {
      method: "DELETE",
      path: "/api/dev/account-data",
      session: "known-token",
      setup: ["1問分の回答を保存", "ENVIRONMENT=production"],
    },
    out: {
      status: 404,
      body: { error: "Not Found", persistedCounts: { diagnosisAnswers: 1 } },
    },
  },
  rejectUnconfiguredReset: {
    id: "ANSWER-009",
    name: "ENVIRONMENT未設定では回答データを削除しないこと",
    in: {
      method: "DELETE",
      path: "/api/dev/account-data",
      session: "known-token",
      setup: ["1問分の回答を保存", "ENVIRONMENT bindingなし"],
    },
    out: {
      status: 404,
      body: { error: "Not Found", persistedCounts: { diagnosisAnswers: 1 } },
    },
  },
  concurrentSaveAndReset: {
    id: "ANSWER-010",
    name: "回答保存とリセットが競合してもSource Recordを孤立させないこと",
    in: {
      method: "PUT + DELETE",
      path: "/api/diagnoses/relationship-priority/answers/{diagnosisQuestionId} + /api/dev/account-data",
      session: "known-token",
      setup: ["1問分の回答を保存", "2問目の保存とリセットを同時実行"],
    },
    out: {
      status: 200,
      body: { orphanedSourceRecords: 0, sourceRecordCountEqualsAnswerCount: true },
    },
  },
} as const satisfies Readonly<Record<string, E2eCase>>;
