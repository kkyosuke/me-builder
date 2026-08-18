import { DO, billing } from "@me-builder/lib";
import type { Message, WeeklyReflectionGenerationQueueMessage } from "@me-builder/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkerConfig } from "../config";
import type { CloudflareBindings } from "../config";
import { processWeeklyReflectionGenerationMessage } from "../handler/weekly-reflection-generation";
import { createAccountDataTestStore } from "../testing/account-data";

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

const ACCOUNT_ID = "weekly-reflection-e2e";
const AT = new Date("2026-08-12T03:00:00.000Z");
const workerConfig = getWorkerConfig({
  ENVIRONMENT: "test",
  GOOGLE_VERTEX_AI_API_KEY: "google-test-key",
  GEMINI_MODEL: "gemini-test",
});

function queueMessage(generationId: string, attempts = 1) {
  return {
    id: `weekly-${generationId}-${attempts}`,
    timestamp: AT,
    attempts,
    body: { type: "weekly-reflection-generation", accountId: ACCOUNT_ID, generationId },
    ack: vi.fn(),
    retry: vi.fn(),
  } as Message<WeeklyReflectionGenerationQueueMessage>;
}

describe("weekly reflection generation E2E", () => {
  beforeEach(() => vi.clearAllMocks());

  it("AccountDataの要求から実モデル境界・版保存まで通し、再配送で重複版を作らない", async () => {
    const store = createAccountDataTestStore();
    store.bind(ACCOUNT_ID);
    const source = await DO.account.action.diary.storeLineTextSource(store.db, {
      accountId: ACCOUNT_ID,
      eventId: "weekly-e2e-diary",
      body: "今週は予定を一つ減らした",
      receivedAt: AT,
    });
    await store.db.insert(DO.account.schema.conversationSessions).values({
      id: "weekly-e2e-session",
      accountId: ACCOUNT_ID,
      status: "closed",
      startedAt: AT,
      lastUserMessageAt: AT,
      closedAt: AT,
      closeReason: "explicit",
    });
    await store.db.insert(DO.account.schema.conversationMessages).values({
      id: "weekly-e2e-message",
      sessionId: "weekly-e2e-session",
      sequence: 1,
      role: "user",
      sourceRecordId: source.sourceRecordId,
      channel: "line",
    });
    const requested = await DO.account.action.weeklyReflection.requestWeeklyReflectionGeneration(
      store.db,
      ACCOUNT_ID,
      AT,
    );
    if (!("generationId" in requested)) throw new Error("weekly generation was not created");
    await DO.account.action.weeklyReflection.markWeeklyReflectionGenerationDispatched(
      store.db,
      ACCOUNT_ID,
      requested.generationId,
      AT,
    );
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        headline: "今週は予定を調整しました",
        items: [
          {
            kind: "question",
            title: "もう少し振り返る",
            description: "予定を減らした後、どんな変化がありましたか？",
            evidence_ids: [`diary:${source.sourceRecordId}`],
          },
        ],
      }),
      candidates: [{ finishReason: "STOP" }],
    });
    const bindings = {
      d1: {},
      do: { accountData: store.namespace },
      planAssignmentProvider: new billing.FakeAccountPlanAssignmentProvider([
        {
          accountId: ACCOUNT_ID,
          plan: "lite",
          source: "subscription",
          effectiveAt: "2026-08-01T00:00:00.000Z",
          availableUntil: null,
          payerAccountId: ACCOUNT_ID,
        },
      ]),
    } as unknown as CloudflareBindings;

    const first = queueMessage(requested.generationId);
    await processWeeklyReflectionGenerationMessage(first, bindings, workerConfig);
    const redelivery = queueMessage(requested.generationId, 2);
    await processWeeklyReflectionGenerationMessage(redelivery, bindings, workerConfig);

    expect(first.ack).toHaveBeenCalledOnce();
    expect(redelivery.ack).toHaveBeenCalledOnce();
    expect(mockGenerateContent).toHaveBeenCalledOnce();
    await expect(
      DO.account.action.weeklyReflection.readWeeklyReflections(store.db, ACCOUNT_ID, AT, "brief"),
    ).resolves.toMatchObject({
      reflections: [
        {
          weekStart: "2026-08-10",
          headline: "今週は予定を調整しました",
          recordCount: 1,
        },
      ],
      generation: { status: "completed", canGenerate: false },
    });
  });
});
