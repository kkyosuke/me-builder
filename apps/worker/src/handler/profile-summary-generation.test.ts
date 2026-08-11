import type { AccountDataNamespace } from "@me-builder/lib";
import type { Message, ProfileSummaryGenerationQueueMessage } from "@me-builder/shared";
import { logger } from "@me-builder/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudflareBindings, WorkerConfig } from "../config";
import { processProfileSummaryGenerationMessage } from "./profile-summary-generation";

const { generateProfileSummary } = vi.hoisted(() => ({ generateProfileSummary: vi.fn() }));
vi.mock("../logic/profile-summary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../logic/profile-summary")>()),
  generateProfileSummary,
}));

const execute = vi.fn();
const accountData = {
  getByName: vi.fn(() => ({ execute })),
} as unknown as AccountDataNamespace;
const cf = {
  d1: {},
  do: { conversation: undefined, accountData },
  queue: { chatTurn: undefined, brainCheckpoint: undefined },
} as unknown as CloudflareBindings;
const workerConfig = {
  environment: "test",
  geminiModel: "gemini-test",
} as WorkerConfig;

function createMessage(attempts = 1): Message<ProfileSummaryGenerationQueueMessage> {
  return {
    id: "queue-message-1",
    timestamp: new Date(),
    attempts,
    body: {
      type: "profile-summary-generation",
      accountId: "account-1",
      generationId: "generation-1",
    },
    ack: vi.fn(),
    retry: vi.fn(),
  } as Message<ProfileSummaryGenerationQueueMessage>;
}

describe("processProfileSummaryGenerationMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logger, "info").mockImplementation(() => undefined);
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    execute.mockImplementation(async (_accountId: string, operation: string) => {
      if (operation === "profileSummary.loadGenerationContext") {
        return {
          generationId: "generation-1",
          evidence: [
            {
              id: "diary:source-1",
              source: "diary",
              text: "日記本文",
              recordedAt: new Date("2026-08-08T00:00:00.000Z"),
            },
          ],
          diagnosisCount: 0,
          diaryCount: 1,
          latestRecordedAt: new Date("2026-08-08T00:00:00.000Z"),
          inputSnapshot: {
            diagnosis: { count: 0, latestRecordedAt: null },
            diary: { count: 1, latestRecordedAt: new Date("2026-08-08T00:00:00.000Z") },
          },
        };
      }
      if (operation === "profileSummary.completeGeneration") return true;
      return undefined;
    });
  });

  it("AI生成結果を新しい版として保存してackする", async () => {
    generateProfileSummary.mockResolvedValue({
      headline: "日々の記録から見えるあなた",
      insights: [
        {
          key: "diary",
          label: "日記を振り返る",
          description: "日々の実感を大切にする傾向があります。",
          evidenceCount: 1,
          sources: ["diary"],
        },
      ],
    });
    const message = createMessage();

    await processProfileSummaryGenerationMessage(message, cf, workerConfig);

    expect(execute).toHaveBeenCalledWith(
      "account-1",
      "profileSummary.completeGeneration",
      expect.objectContaining({
        generationId: "generation-1",
        model: "gemini-test",
        diaryCount: 1,
        inputSnapshot: expect.objectContaining({ diary: expect.objectContaining({ count: 1 }) }),
      }),
    );
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("最終試行で失敗状態を保存してDLQへ送る", async () => {
    generateProfileSummary.mockResolvedValue(undefined);
    const message = createMessage(6);

    await processProfileSummaryGenerationMessage(message, cf, workerConfig);

    expect(execute).toHaveBeenCalledWith(
      "account-1",
      "profileSummary.failGeneration",
      "generation-1",
      expect.any(String),
    );
    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
  });
});
