import type { E2eCase } from "./e2e-case";

// 正式なAPI契約は docs/development/questionnaire-api.md を参照する。
export const surveyDetailCases = {
  available: {
    id: "DETAIL-001",
    name: "seedのSurveyからQuestion VersionとChoiceを位置順に返すこと",
    in: {
      method: "GET",
      path: "/api/surveys/relationship-priority",
      authorization: "Bearer known-token",
      setup: ["migrationとquestionnaire seedを適用"],
    },
    out: {
      status: 200,
      body: {
        id: "relationship-priority",
        questionCount: 10,
        firstQuestion: {
          surveyQuestionId: "sq-relationship-priority-01",
          questionVersion: 1,
          choices: [
            {
              choiceId: "no",
              presentation: {
                icon: "circle-x",
              },
            },
            {
              choiceId: "yes",
              presentation: {
                icon: "circle-check",
              },
            },
          ],
        },
      },
    },
  },
  notFound: {
    id: "DETAIL-002",
    name: "存在しないSurveyを404にすること",
    in: {
      method: "GET",
      path: "/api/surveys/missing",
      authorization: "Bearer known-token",
    },
    out: {
      status: 404,
      body: {
        error: "Survey not found",
        reason: "survey_not_found",
      },
    },
  },
  closed: {
    id: "DETAIL-003",
    name: "受付終了したSurveyを409にすること",
    in: {
      method: "GET",
      path: "/api/surveys/relationship-priority",
      authorization: "Bearer known-token",
      setup: ["relationship-priorityのcloses_atを現在時刻に更新"],
    },
    out: {
      status: 409,
      body: {
        error: "Survey closed",
        reason: "survey_closed",
      },
    },
  },
} as const satisfies Readonly<Record<string, E2eCase>>;
