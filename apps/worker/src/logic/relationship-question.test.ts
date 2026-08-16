import type {
  BrainChatContextMemory,
  ConversationContextMessage,
  RelationshipDiagnosisContext,
} from "@me-builder/lib";
import { describe, expect, it } from "vitest";
import {
  buildRelationshipQuestionPlan,
  selectFullRelationshipHistory,
} from "./relationship-question";

const messages: ConversationContextMessage[] = [
  { id: "old-user", role: "user", body: "昨日は散歩した", sequence: 1 },
  { id: "old-assistant", role: "assistant", body: "穏やかな時間だったね", sequence: 2 },
  { id: "current", role: "user", body: "職場の同僚と気まずくなった", sequence: 3 },
];

const diagnoses: RelationshipDiagnosisContext[] = [
  {
    ownerAccountId: "account-1",
    diagnosisId: "work-style",
    relationshipCategory: "work",
    statement: "意見を整理してから伝える傾向がある",
  },
  {
    ownerAccountId: "account-1",
    diagnosisId: "partner-style",
    relationshipCategory: "partner",
    statement: "早めの相談を好む傾向がある",
  },
  {
    ownerAccountId: "third-party",
    diagnosisId: "unshared-secret",
    relationshipCategory: "work",
    statement: "第三者だけが回答した非共有情報",
  },
];

describe("buildRelationshipQuestionPlan", () => {
  it("Freeは現在の本人発言だけを使い、診断をContextへ入れない", () => {
    const plan = buildRelationshipQuestionPlan({
      accountId: "account-1",
      mode: "current-message",
      messages,
      currentUserMessageIds: ["current"],
      diagnoses,
    });
    expect(plan.active).toBe(true);
    if (!plan.active) throw new Error("relationship plan was not activated");
    expect(plan.messages.map(({ id }) => id)).toEqual(["current"]);
    expect(plan.context).toMatchObject({ category: "work", personReferenceStatus: "confirmed" });
    expect(plan.context.diagnoses).toEqual([]);
  });

  it("Liteは現在Sessionと本人の関連診断だけを使い、第三者の非共有情報を除外する", () => {
    const plan = buildRelationshipQuestionPlan({
      accountId: "account-1",
      mode: "session-and-diagnosis",
      messages,
      currentUserMessageIds: ["current"],
      diagnoses,
    });
    expect(plan.active).toBe(true);
    if (!plan.active) throw new Error("relationship plan was not activated");
    expect(plan.messages).toEqual(messages);
    expect(plan.context.diagnoses).toEqual([diagnoses[0]]);
    expect(JSON.stringify(plan.context)).not.toContain("unshared-secret");
    expect(JSON.stringify(plan.context)).not.toContain("第三者だけが回答した非共有情報");
  });

  it("相手や区分が曖昧な場合は確認が必要だと示す", () => {
    const plan = buildRelationshipQuestionPlan({
      accountId: "account-1",
      mode: "session-and-diagnosis",
      messages: [{ id: "current", role: "user", body: "あの人と揉めた", sequence: 1 }],
      currentUserMessageIds: ["current"],
      diagnoses,
    });
    expect(plan).toMatchObject({
      active: true,
      context: { personReferenceStatus: "needs-confirmation", diagnoses: [] },
    });
  });

  it("関係性以外の話題は既存の会話Contextを変更しない", () => {
    const plan = buildRelationshipQuestionPlan({
      accountId: "account-1",
      mode: "current-message",
      messages,
      currentUserMessageIds: ["old-user"],
      diagnoses,
    });
    expect(plan).toEqual({ active: false, messages });
  });

  it("会社や仕事という区分語だけでは相手のいる話題と決めつけない", () => {
    const workDiary = [
      { id: "current", role: "user" as const, body: "会社で資料を仕上げた", sequence: 1 },
    ];
    expect(
      buildRelationshipQuestionPlan({
        accountId: "account-1",
        mode: "current-message",
        messages: workDiary,
        currentUserMessageIds: ["current"],
      }),
    ).toEqual({ active: false, messages: workDiary });
  });
});

const fullMemory = (overrides: Partial<BrainChatContextMemory>): BrainChatContextMemory => ({
  brainItemId: "history-1",
  category: "memory",
  statement: "上司と面談して、希望を伝えた",
  derivation: "ai",
  isInference: false,
  status: "active",
  confidence: { state: "confirmed" },
  accessLabels: ["relationship"],
  firstObservedAt: new Date("2026-08-01T00:00:00Z"),
  lastObservedAt: new Date("2026-08-01T00:00:00Z"),
  evidence: [
    {
      sourceRecordId: "source-1",
      text: "上司と面談して、希望を伝えた",
      recordedAt: new Date("2026-08-01T00:00:00Z"),
    },
  ],
  ...overrides,
});

describe("selectFullRelationshipHistory", () => {
  it("現在の相手に一致する確認済み出来事とGoalだけを返す", () => {
    const plan = buildRelationshipQuestionPlan({
      accountId: "account-1",
      mode: "confirmed-history",
      messages: [{ id: "current", role: "user", body: "上司との面談が不安", sequence: 1 }],
      currentUserMessageIds: ["current"],
    });
    if (!plan.active) throw new Error("relationship plan was not activated");
    const memories = [
      fullMemory({}),
      fullMemory({ brainItemId: "goal", category: "goal", statement: "上司へ来週相談したい" }),
      fullMemory({ brainItemId: "other", statement: "友達と旅行した" }),
      fullMemory({ brainItemId: "inferred", isInference: true }),
      fullMemory({ brainItemId: "unsupported", evidence: [] }),
      fullMemory({ brainItemId: "style", category: "preference" }),
    ];

    expect(
      selectFullRelationshipHistory(plan.context, memories).map(({ brainItemId }) => brainItemId),
    ).toEqual(["history-1", "goal"]);
  });

  it("同名別人を区別できない固有名の履歴は安全側で利用しない", () => {
    const plan = buildRelationshipQuestionPlan({
      accountId: "account-1",
      mode: "confirmed-history",
      messages: [{ id: "current", role: "user", body: "田中さんと揉めた", sequence: 1 }],
      currentUserMessageIds: ["current"],
    });
    if (!plan.active) throw new Error("relationship plan was not activated");
    expect(
      selectFullRelationshipHistory(plan.context, [
        fullMemory({ statement: "田中さんと以前相談した" }),
      ]),
    ).toEqual([]);
  });
});
