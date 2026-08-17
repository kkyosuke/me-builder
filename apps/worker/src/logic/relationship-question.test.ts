import type {
  BrainChatContextMemory,
  ConversationContextMessage,
  RelationshipDiagnosisContext,
} from "@me-builder/lib";
import { describe, expect, it } from "vitest";
import {
  buildRelationshipQuestionPlan,
  buildRelationshipSearchHints,
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

  it("一意な相性共有相手なら表示名と関係語を同じ人物の検索対象にする", () => {
    const plan = buildRelationshipQuestionPlan({
      accountId: "account-1",
      mode: "confirmed-history",
      messages: [{ id: "current", role: "user", body: "最近パートナーと喧嘩した", sequence: 1 }],
      currentUserMessageIds: ["current"],
      sharedRelationships: [
        { relationshipCategory: "partner", partnerDisplayName: "美咲" },
        { relationshipCategory: "friend", partnerDisplayName: "拓海" },
      ],
    });
    if (!plan.active) throw new Error("relationship plan was not activated");

    expect(buildRelationshipSearchHints(plan.context)).toEqual(["美咲", "partner", "パートナー"]);
    expect(plan.context.matchedSharedRelationship).toEqual({
      relationshipCategory: "partner",
      partnerDisplayName: "美咲",
    });
    expect(
      selectFullRelationshipHistory(plan.context, [
        fullMemory({ brainItemId: "named", statement: "美咲は言い争うと一度黙る" }),
        fullMemory({ brainItemId: "alias", statement: "彼女は土日が休み" }),
        fullMemory({ brainItemId: "other-named", statement: "健太さんは彼氏との話を聞いた" }),
        fullMemory({ brainItemId: "other-shared", statement: "友達の拓海は彼氏がいる" }),
        fullMemory({ brainItemId: "other", statement: "上司は結論を先に聞きたい人" }),
      ]).map(({ brainItemId }) => brainItemId),
    ).toEqual(["named", "alias"]);
  });

  it("共有相手が複数いて一意に照合できない場合は人物を決めつけない", () => {
    const plan = buildRelationshipQuestionPlan({
      accountId: "account-1",
      mode: "confirmed-history",
      messages: [{ id: "current", role: "user", body: "友達と揉めた", sequence: 1 }],
      currentUserMessageIds: ["current"],
      sharedRelationships: [
        { relationshipCategory: "friend", partnerDisplayName: "美咲" },
        { relationshipCategory: "friend", partnerDisplayName: "拓海" },
      ],
    });
    if (!plan.active) throw new Error("relationship plan was not activated");
    expect(plan.context.matchedSharedRelationship).toBeUndefined();
    expect(plan.context.personReferenceStatus).toBe("needs-confirmation");
    expect(buildRelationshipSearchHints(plan.context)).toEqual([]);
    expect(
      selectFullRelationshipHistory(plan.context, [fullMemory({ statement: "友達と話した" })]),
    ).toEqual([]);
  });

  it("明示された区分と共有相手の区分が矛盾する場合は照合しない", () => {
    const plan = buildRelationshipQuestionPlan({
      accountId: "account-1",
      mode: "confirmed-history",
      messages: [{ id: "current", role: "user", body: "友達の美咲と喧嘩した", sequence: 1 }],
      currentUserMessageIds: ["current"],
      sharedRelationships: [{ relationshipCategory: "partner", partnerDisplayName: "美咲" }],
    });
    if (!plan.active) throw new Error("relationship plan was not activated");
    expect(plan.context).toMatchObject({
      category: "friend",
      personReferenceStatus: "needs-confirmation",
    });
    expect(plan.context.matchedSharedRelationship).toBeUndefined();
    expect(buildRelationshipSearchHints(plan.context)).toEqual([]);
  });

  it("親友を家族の親と誤認せず、別区分の履歴を混ぜない", () => {
    const friendPlan = buildRelationshipQuestionPlan({
      accountId: "account-1",
      mode: "confirmed-history",
      messages: [{ id: "current", role: "user", body: "親友と喧嘩した", sequence: 1 }],
      currentUserMessageIds: ["current"],
      sharedRelationships: [{ relationshipCategory: "friend", partnerDisplayName: "美咲" }],
    });
    if (!friendPlan.active) throw new Error("relationship plan was not activated");
    expect(friendPlan.context).toMatchObject({
      category: "friend",
      personReferenceStatus: "confirmed",
    });

    const familyPlan = buildRelationshipQuestionPlan({
      accountId: "account-1",
      mode: "confirmed-history",
      messages: [{ id: "current", role: "user", body: "母と喧嘩した", sequence: 1 }],
      currentUserMessageIds: ["current"],
      sharedRelationships: [{ relationshipCategory: "family", partnerDisplayName: "恵子" }],
    });
    if (!familyPlan.active) throw new Error("relationship plan was not activated");
    expect(
      selectFullRelationshipHistory(familyPlan.context, [
        fullMemory({ brainItemId: "friend", statement: "親友は一度黙って考える" }),
      ]),
    ).toEqual([]);
  });
});
