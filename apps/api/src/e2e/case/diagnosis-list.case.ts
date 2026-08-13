import type { E2eCase } from "./e2e-case";

// 正式なAPI契約は docs/development/diagnosis-api.md を参照する。
export const diagnosisListCases = {
  progress: {
    id: "LIST-001",
    name: "migrationとseedからAccount別の回答進捗を返すこと",
    in: {
      method: "GET",
      path: "/api/diagnoses",
      authorization: "Bearer known-token",
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
  missingAuthorization: {
    id: "LIST-002",
    name: "Bearerトークンが無い場合は401を返すこと",
    in: {
      method: "GET",
      path: "/api/diagnoses",
      authorization: null,
    },
    out: {
      status: 401,
      body: {
        error: "Unauthorized",
      },
    },
  },
  invalidToken: {
    id: "LIST-003",
    name: "LINEがIDトークンを検証できない場合は401を返すこと",
    in: {
      method: "GET",
      path: "/api/diagnoses",
      authorization: "Bearer invalid-token",
    },
    out: {
      status: 401,
      body: {
        error: "Unauthorized",
      },
    },
  },
  accountNotFound: {
    id: "LIST-004",
    name: "検証済みの本人に対応するAccountが無い場合は404を返すこと",
    in: {
      method: "GET",
      path: "/api/diagnoses",
      authorization: "Bearer unknown-token",
    },
    out: {
      status: 404,
      body: {
        error: "Account not found",
        reason: "friendship_required",
      },
    },
  },
} as const satisfies Readonly<Record<string, E2eCase>>;
