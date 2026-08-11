import type { E2eCase } from "./e2e-case";

// 正式なAPI契約は docs/development/compatibility-api.md を参照する。
export const compatibilitySharePreviewCases = {
  completedDiagnosis: {
    id: "COMPATIBILITY-PREVIEW-001",
    name: "回答完了後に共有可能な傾向だけを返すこと",
    in: {
      method: "GET",
      path: "/api/compatibility/share-preview",
      authorization: "Bearer known-token",
      setup: [
        "migrationとdiagnosis seedを適用",
        "relationship-priorityの10問すべてへchoiceId=yesを保存",
      ],
    },
    out: {
      status: 200,
      body: {
        displayName: "あおい",
        previewTokenPattern: "^csp2\\.[a-f0-9]{64}$",
        canIssueInvitation: true,
        blockingReasons: [],
        nextAction: null,
        themeCount: 1,
        parameterCount: 4,
        excludedFields: ["choiceId", "questionText", "coverage", "accountId", "fingerprint"],
      },
    },
  },
} as const satisfies Record<string, E2eCase>;
