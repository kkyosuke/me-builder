import type { AccountDataNamespace, CompatibilityDataNamespace } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import { endCompatibilityRelationship } from "./compatibility-relationship-end";

const relationshipId = "1".repeat(64);
const params = {
  relationshipId,
  actor: {
    accountId: "account-a",
    authenticationMethod: "liff" as const,
    authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
  },
  accountData: {} as AccountDataNamespace,
  compatibilityData: {} as CompatibilityDataNamespace,
};

function dependencies(session: unknown, canonical: unknown = { outcome: "ended" }) {
  return {
    createSession: vi.fn().mockResolvedValue(session),
    endRelationship: vi.fn().mockResolvedValue(canonical),
  };
}

describe("endCompatibilityRelationship", () => {
  it("不正なrelationship IDは本人確認も正本更新も始めない", async () => {
    const deps = dependencies({ type: "resolved", session: { accountId: "account-a" } });
    await expect(
      endCompatibilityRelationship({ ...params, relationshipId: "invalid" }, deps),
    ).resolves.toEqual({ type: "unavailable" });
    expect(deps.createSession).not.toHaveBeenCalled();
    expect(deps.endRelationship).not.toHaveBeenCalled();
  });

  it.each(["ended", "unchanged"] as const)("正本の%sを成功へ変換する", async (outcome) => {
    const deps = dependencies(
      { type: "resolved", session: { accountId: "account-a" } },
      { outcome },
    );
    await expect(endCompatibilityRelationship(params, deps)).resolves.toEqual({ type: "ended" });
    expect(deps.endRelationship).toHaveBeenCalledWith(
      params.accountData,
      params.compatibilityData,
      relationshipId,
      "account-a",
    );
  });

  it.each(["not-found", "unavailable"] as const)(
    "正本の%sをunavailableへ変換する",
    async (outcome) => {
      const deps = dependencies(
        { type: "resolved", session: { accountId: "account-a" } },
        { outcome },
      );
      await expect(endCompatibilityRelationship(params, deps)).resolves.toEqual({
        type: "unavailable",
      });
    },
  );
});
