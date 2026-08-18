import { type AccountDataNamespace, billing } from "@me-builder/lib";
import type { Message, WeeklyReflectionGenerationQueueMessage } from "@me-builder/shared";
import { logger } from "@me-builder/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudflareBindings, WorkerConfig } from "../config";
import { processWeeklyReflectionGenerationMessage } from "./weekly-reflection-generation";

const { generateWeeklyReflection } = vi.hoisted(() => ({ generateWeeklyReflection: vi.fn() }));
vi.mock("../logic/weekly-reflection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../logic/weekly-reflection")>()),
  generateWeeklyReflection,
}));

const execute = vi.fn();
const accountData = {
  getByName: vi.fn(() => ({ execute })),
} as unknown as AccountDataNamespace;
const workerConfig = {
  environment: "test",
  geminiModel: "gemini-test",
  googleVertexAiApiKey: "test-key",
} as WorkerConfig;

function planAssignmentProvider(plan: "free" | "lite" | "full" | "family") {
  return new billing.FakeAccountPlanAssignmentProvider([
    {
      accountId: "account-1",
      plan,
      source: plan === "free" ? "free" : plan === "family" ? "family-seat" : "subscription",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      availableUntil: null,
      payerAccountId: plan === "free" ? null : plan === "family" ? "payer-1" : "account-1",
    },
  ]);
}

function bindings(plan: "free" | "lite" | "full" | "family" = "lite") {
  return {
    d1: {},
    do: { accountData },
    planAssignmentProvider: planAssignmentProvider(plan),
  } as unknown as CloudflareBindings;
}

function message(attempts = 1): Message<WeeklyReflectionGenerationQueueMessage> {
  return {
    id: "weekly-message-1",
    timestamp: new Date(),
    attempts,
    body: {
      type: "weekly-reflection-generation",
      accountId: "account-1",
      generationId: "weekly-generation-1",
    },
    ack: vi.fn(),
    retry: vi.fn(),
  } as Message<WeeklyReflectionGenerationQueueMessage>;
}

describe("processWeeklyReflectionGenerationMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    execute.mockImplementation(async (_accountId: string, operation: string) => {
      if (operation === "weeklyReflection.loadGenerationContext") {
        return {
          generationId: "weekly-generation-1",
          weekStart: "2026-08-10",
          evidence: [
            {
              id: "diary:source-1",
              source: "diary",
              text: "予定を一つ減らした",
              recordedAt: new Date("2026-08-12T00:00:00.000Z"),
            },
          ],
        };
      }
      if (operation === "weeklyReflection.completeGeneration") return true;
      return undefined;
    });
  });

  it.each(["lite", "full", "family"] as const)("%sでは生成結果を一度だけ保存する", async (plan) => {
    generateWeeklyReflection.mockResolvedValue({
      type: "generated",
      headline: "今週の振り返り",
      items: [
        {
          kind: "question",
          title: "心に残ったこと",
          description: "もう少し話せることはありますか？",
          evidenceCount: 1,
          sources: ["diary"],
        },
      ],
    });
    const queueMessage = message();

    await processWeeklyReflectionGenerationMessage(queueMessage, bindings(plan), workerConfig);

    expect(execute).toHaveBeenCalledWith(
      "account-1",
      "weeklyReflection.completeGeneration",
      expect.objectContaining({ generationId: "weekly-generation-1", model: "gemini-test" }),
    );
    expect(
      execute.mock.calls.filter(
        ([, operation]) => operation === "weeklyReflection.completeGeneration",
      ),
    ).toHaveLength(1);
    expect(queueMessage.ack).toHaveBeenCalledOnce();
    expect(queueMessage.retry).not.toHaveBeenCalled();
  });

  it("Queue処理前にFreeへ変更された場合はAIを呼ばず失敗表示を保存する", async () => {
    const queueMessage = message();

    await processWeeklyReflectionGenerationMessage(queueMessage, bindings("free"), workerConfig);

    expect(generateWeeklyReflection).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(
      "account-1",
      "weeklyReflection.failGeneration",
      "weekly-generation-1",
      "現在のプランでは新しい週次振り返りを作成できません。",
    );
    expect(queueMessage.ack).toHaveBeenCalledOnce();
  });

  it("一時失敗は途中試行で状態を確定せず再配送する", async () => {
    generateWeeklyReflection.mockResolvedValue({ type: "failed", reason: "response_empty" });
    const queueMessage = message(1);

    await processWeeklyReflectionGenerationMessage(queueMessage, bindings(), workerConfig);

    expect(queueMessage.retry).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalledWith(
      "account-1",
      "weeklyReflection.failGeneration",
      expect.anything(),
      expect.anything(),
    );
  });

  it("最終試行は失敗表示を保存してDLQへ渡す", async () => {
    generateWeeklyReflection.mockResolvedValue({
      type: "failed",
      reason: "response_schema_mismatch",
    });
    const queueMessage = message(6);

    await processWeeklyReflectionGenerationMessage(queueMessage, bindings(), workerConfig);

    expect(execute).toHaveBeenCalledWith(
      "account-1",
      "weeklyReflection.failGeneration",
      "weekly-generation-1",
      expect.any(String),
    );
    expect(queueMessage.retry).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ disposition: "dead-letter" }),
      expect.any(String),
    );
  });

  it("AI設定不足は再配送せず失敗表示を確定してackする", async () => {
    generateWeeklyReflection.mockResolvedValue({
      type: "failed",
      reason: "ai_credentials_missing",
    });
    const queueMessage = message();

    await processWeeklyReflectionGenerationMessage(queueMessage, bindings(), workerConfig);

    expect(execute).toHaveBeenCalledWith(
      "account-1",
      "weeklyReflection.failGeneration",
      "weekly-generation-1",
      expect.any(String),
    );
    expect(queueMessage.ack).toHaveBeenCalledOnce();
    expect(queueMessage.retry).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ disposition: "ack", retryable: false }),
      expect.any(String),
    );
  });

  it("保存時にgenerationが失効していた場合は再試行loopにせずackする", async () => {
    execute.mockImplementation(async (_accountId: string, operation: string) => {
      if (operation === "weeklyReflection.loadGenerationContext") {
        return {
          generationId: "weekly-generation-1",
          weekStart: "2026-08-10",
          evidence: [
            {
              id: "diary:source-1",
              source: "diary",
              text: "予定を一つ減らした",
              recordedAt: new Date("2026-08-12T00:00:00.000Z"),
            },
          ],
        };
      }
      if (operation === "weeklyReflection.completeGeneration") return false;
      return undefined;
    });
    generateWeeklyReflection.mockResolvedValue({
      type: "generated",
      headline: "今週の振り返り",
      items: [],
    });
    const queueMessage = message(2);

    await processWeeklyReflectionGenerationMessage(queueMessage, bindings(), workerConfig);

    expect(queueMessage.ack).toHaveBeenCalledOnce();
    expect(queueMessage.retry).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "WEEKLY_REFLECTION_COMPLETION_REJECTED",
        disposition: "ack",
      }),
      expect.any(String),
    );
  });

  it("完了後の再配送はAIと保存を繰り返さずackする", async () => {
    execute.mockResolvedValue(null);
    const queueMessage = message(2);

    await processWeeklyReflectionGenerationMessage(queueMessage, bindings(), workerConfig);

    expect(generateWeeklyReflection).not.toHaveBeenCalled();
    expect(queueMessage.ack).toHaveBeenCalledOnce();
  });
});
