import type { E2eCase } from "./e2e-case";

// 正式なAPI契約は docs/development/diagnosis-api.md を参照する。
export const diagnosisDetailCases = {
  available: {
    id: "DETAIL-001",
    name: "seedのDiagnosisからQuestion VersionとChoiceを位置順に返すこと",
    in: {
      method: "GET",
      path: "/api/diagnoses/relationship-priority",
      authorization: "Bearer known-token",
      setup: ["migrationとdiagnosis seedを適用"],
    },
    out: {
      status: 200,
      body: {
        id: "relationship-priority",
        relationshipCategory: "partner",
        questionCount: 10,
        firstQuestion: {
          diagnosisQuestionId: "dq-relationship-priority-01",
          questionVersion: 1,
          choices: [{ choiceId: "no" }, { choiceId: "yes" }],
        },
      },
    },
  },
  notFound: {
    id: "DETAIL-002",
    name: "存在しないDiagnosisを404にすること",
    in: {
      method: "GET",
      path: "/api/diagnoses/missing",
      authorization: "Bearer known-token",
    },
    out: {
      status: 404,
      body: {
        error: "Diagnosis not found",
        reason: "diagnosis_not_found",
      },
    },
  },
  closed: {
    id: "DETAIL-003",
    name: "受付終了したDiagnosisを409にすること",
    in: {
      method: "GET",
      path: "/api/diagnoses/relationship-priority",
      authorization: "Bearer known-token",
      setup: ["relationship-priorityのcloses_atを現在時刻に更新"],
    },
    out: {
      status: 409,
      body: {
        error: "Diagnosis closed",
        reason: "diagnosis_closed",
      },
    },
  },
} as const satisfies Readonly<Record<string, E2eCase>>;
