import type { E2eCase } from "./e2e-case";

// 正式なAPI契約は docs/development/diagnosis-api.md を参照する。
export const diagnosisListCases = {
  progress: {
    id: "LIST-001",
    name: "migrationとseedからAccount別の回答進捗を返すこと",
    in: {
      method: "GET",
      path: "/api/diagnoses",
      session: "known-token",
      setup: [
        "migrationとdiagnosis seedを適用",
        "money-valuesへ1問、relationship-priorityへ10問の回答を登録",
      ],
    },
    out: {
      status: 200,
      body: {
        diagnoses: {
          "money-values": {
            relationshipCategory: "partner",
            responseStatus: "in-progress",
            answeredCount: 1,
            questionCount: 10,
          },
          "relationship-priority": {
            relationshipCategory: "partner",
            responseStatus: "answered",
            answeredCount: 10,
            questionCount: 10,
          },
        },
      },
    },
  },
  missingSession: {
    id: "LIST-002",
    name: "アプリセッションが無い場合は401を返すこと",
    in: {
      method: "GET",
      path: "/api/diagnoses",
      session: null,
    },
    out: {
      status: 401,
      body: {
        error: "Unauthorized",
      },
    },
  },
  bearerRejected: {
    id: "LIST-003",
    name: "Bearerトークンだけでは認証されず401を返すこと",
    in: {
      method: "GET",
      path: "/api/diagnoses",
      session: "bearer-only",
    },
    out: {
      status: 401,
      body: {
        error: "Unauthorized",
      },
    },
  },
  webFirstAccountCreation: {
    id: "LIST-004",
    name: "交換済みセッションの本人用Accountについて一覧を返すこと",
    in: {
      method: "GET",
      path: "/api/diagnoses",
      session: "unknown-token",
    },
    out: {
      status: 200,
      body: {
        diagnoses: {
          count: 10,
          responseStatus: "unanswered",
        },
      },
    },
  },
} as const satisfies Readonly<Record<string, E2eCase>>;
