import { type AccountDataNamespace, type D1, billing } from "@me-builder/lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listPersonalData } from "../logic/personal-data";
import { getProfileEntitlement } from "../logic/profile-entitlement";

const { createLiffSession } = vi.hoisted(() => ({ createLiffSession: vi.fn() }));
vi.mock("../logic/liff-session", () => ({ createLiffSession }));

const accountId = "preview-user";
const at = new Date("2026-08-16T12:00:00.000Z");

function createAccountData() {
  const records = [
    {
      id: "diary-after-downgrade",
      kind: "diary",
      title: "日記",
      value: "以前のPlanで保存した振り返り",
      recordedAt: "2026-08-01T00:00:00.000Z",
    },
  ];
  const execute = vi.fn(async (boundAccountId: string, operation: string, ...args: unknown[]) => {
    expect(boundAccountId).toBe(accountId);
    if (operation === "source.listPersonalData") return records;
    if (operation === "aiUsage.read") {
      const [kind, period, limit] = args as [string, unknown, number];
      return { kind, period, limit, reserved: 0, committed: 1, remaining: limit - 1 };
    }
    throw new Error(`Unexpected AccountData operation: ${operation}`);
  });
  const getByName = vi.fn(() => ({ execute }));
  return {
    binding: { getByName } as unknown as AccountDataNamespace,
    execute,
    getByName,
  };
}

function assignment(
  plan: "free" | "lite" | "full" | "family",
  source: "free" | "subscription" | "family-seat",
  effectiveAt = "2026-08-01T00:00:00.000Z",
  availableUntil: string | null = null,
): billing.AccountPlanAssignment {
  return {
    accountId,
    plan,
    source,
    effectiveAt,
    availableUntil,
    payerAccountId: source === "family-seat" ? "preview-payer" : plan === "free" ? null : accountId,
  };
}

describe("Preview Plan assignment verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createLiffSession.mockResolvedValue({
      type: "resolved",
      session: { accountId, role: "user" },
    });
  });

  it.each([
    ["lite", "subscription", 150, 4],
    ["full", "subscription", 600, 12],
    ["family", "family-seat", 600, 12],
  ] as const)(
    "fake assignmentを%sへ切り替えると付与元・利用上限を即時検証できる",
    async (plan, source, aiLimit, summaryLimit) => {
      const provider = new billing.FakeAccountPlanAssignmentProvider([assignment(plan, source)]);
      const { binding } = createAccountData();

      await expect(
        getProfileEntitlement({
          idToken: "preview-token",
          lineLoginChannelId: "preview-channel",
          db: {} as D1.shared.Client,
          accountData: binding,
          planAssignmentProvider: provider,
          at,
        }),
      ).resolves.toMatchObject({
        type: "resolved",
        status: "active",
        plan,
        source,
        aiReply: { limit: aiLimit, remaining: aiLimit - 1 },
        profileSummary: { limit: summaryLimit, remaining: summaryLimit - 1 },
      });
    },
  );

  it("適用前と期限後はFreeになり、downgrade後も本人の既存データを閲覧できる", async () => {
    const provider = new billing.FakeAccountPlanAssignmentProvider([
      assignment("full", "subscription", "2026-08-16T12:05:00.000Z", "2026-09-16T12:05:00.000Z"),
    ]);
    const accountData = createAccountData();

    const beforeStart = await new billing.EntitlementService(provider).resolve(accountId, at);
    expect(beforeStart).toMatchObject({ plan: "free", source: "free" });
    await expect(
      new billing.EntitlementService(provider).resolve(
        accountId,
        new Date("2026-08-16T12:05:00.000Z"),
      ),
    ).resolves.toMatchObject({ plan: "full", source: "subscription" });
    await expect(
      new billing.EntitlementService(provider).resolve(
        accountId,
        new Date("2026-09-16T12:05:00.000Z"),
      ),
    ).resolves.toMatchObject({ plan: "free", source: "free" });

    provider.set(assignment("free", "free", "2026-09-16T12:05:00.000Z"));
    const records = await listPersonalData({
      idToken: "preview-token",
      lineLoginChannelId: "preview-channel",
      db: {} as D1.shared.Client,
      accountData: accountData.binding,
    });
    expect(records).toMatchObject({
      type: "resolved",
      records: [{ id: "diary-after-downgrade", value: "以前のPlanで保存した振り返り" }],
    });
    expect(accountData.getByName).toHaveBeenCalledWith(accountId);
  });
});
