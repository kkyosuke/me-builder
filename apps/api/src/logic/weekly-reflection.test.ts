import { type AccountDataNamespace, type D1, billing } from "@me-builder/lib";
import type { Queue, ReflectionGenerationQueueMessage } from "@me-builder/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWeeklyReflections, requestWeeklyReflectionGeneration } from "./weekly-reflection";

const { createLiffSession } = vi.hoisted(() => ({ createLiffSession: vi.fn() }));
vi.mock("./liff-session", () => ({ createLiffSession }));

const execute = vi.fn();
const accountData = {
  getByName: vi.fn(() => ({ execute })),
} as unknown as AccountDataNamespace;
const send = vi.fn();
const queue = { send } as unknown as Queue<ReflectionGenerationQueueMessage>;
const at = new Date("2026-08-15T00:00:00.000Z");
const readModel = {
  reflections: [
    {
      weekStart: "2026-08-03",
      generatedAt: "2026-08-09T00:00:00.000Z",
      headline: "先週の振り返り",
      items: [
        {
          kind: "question" as const,
          title: "短い問い",
          description: "どうでしたか？",
          evidenceCount: 1,
          sources: ["diary" as const],
        },
      ],
      recordCount: 1,
    },
  ],
  monthlyChanges: [],
  generation: {
    weekStart: "2026-08-10",
    status: "idle" as const,
    canGenerate: true,
    message: null,
    notification: "not-applicable" as const,
  },
};

function provider(plan: "free" | "lite" | "full") {
  return new billing.FakeAccountPlanAssignmentProvider([
    {
      accountId: "account-1",
      plan,
      source: plan === "free" ? "free" : "subscription",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      availableUntil: null,
      payerAccountId: plan === "free" ? null : "account-1",
    },
  ]);
}

describe("weekly reflection entitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createLiffSession.mockResolvedValue({
      type: "resolved",
      session: { accountId: "account-1", role: "user" },
    });
  });

  it("Freeでも生成済み結果は返すが、新しい生成は開始しない", async () => {
    execute.mockResolvedValue(readModel);
    await expect(
      getWeeklyReflections({
        idToken: "token",
        lineLoginChannelId: "channel",
        db: {} as D1.shared.Client,
        accountData,
        planAssignmentProvider: provider("free"),
        at,
      }),
    ).resolves.toMatchObject({
      type: "resolved",
      canStartNew: false,
      reflections: readModel.reflections,
    });
    await expect(
      requestWeeklyReflectionGeneration({
        idToken: "token",
        lineLoginChannelId: "channel",
        db: {} as D1.shared.Client,
        accountData,
        queue,
        planAssignmentProvider: provider("free"),
        at,
      }),
    ).resolves.toEqual({ type: "unavailable", reason: "feature_unavailable" });
    expect(send).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith("account-1", "weeklyReflection.read", at, "none");
  });

  it.each([
    ["lite", "brief"],
    ["full", "full"],
  ] as const)("%sの月次表示modeをAccountDataへ渡す", async (plan, mode) => {
    execute.mockResolvedValue(readModel);
    await getWeeklyReflections({
      idToken: "token",
      lineLoginChannelId: "channel",
      db: {} as D1.shared.Client,
      accountData,
      planAssignmentProvider: provider(plan),
      at,
    });
    expect(execute).toHaveBeenCalledWith("account-1", "weeklyReflection.read", at, mode);
  });

  it("Liteは生成要求をAccountDataへ保存してQueueへ本文なしで渡す", async () => {
    execute
      .mockResolvedValueOnce({
        outcome: "created",
        generationId: "generation-1",
        status: "queued",
        needsDispatch: true,
      })
      .mockResolvedValueOnce(true);
    await expect(
      requestWeeklyReflectionGeneration({
        idToken: "token",
        lineLoginChannelId: "channel",
        db: {} as D1.shared.Client,
        accountData,
        queue,
        planAssignmentProvider: provider("lite"),
        at,
      }),
    ).resolves.toMatchObject({ type: "accepted", generationId: "generation-1", created: true });
    expect(send).toHaveBeenCalledWith({
      type: "weekly-reflection-generation",
      accountId: "account-1",
      generationId: "generation-1",
    });
  });
});
