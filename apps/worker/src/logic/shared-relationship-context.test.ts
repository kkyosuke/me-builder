import type { AccountDataNamespace, CompatibilityDataNamespace } from "@me-builder/lib";
import { describe, expect, it, vi } from "vitest";
import type { CloudflareBindings } from "../config";
import { loadSharedRelationshipContexts } from "./shared-relationship-context";

describe("loadSharedRelationshipContexts", () => {
  it("activeな相性共有を表示名とカテゴリだけへ射影する", async () => {
    const accountExecute = vi.fn().mockResolvedValue([
      {
        relationshipId: "relationship-1",
        accountId: "account-1",
        role: "inviter",
        partnerAccountId: "account-2",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        relationshipId: "relationship-pending",
        accountId: "account-1",
        role: "inviter",
        partnerAccountId: null,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const accountData = {
      getByName: vi.fn(() => ({ execute: accountExecute })),
    } as unknown as AccountDataNamespace;
    const getRelationship = vi.fn().mockResolvedValue({
      id: "relationship-1",
      inviterAccountId: "account-1",
      inviteeAccountId: "account-2",
      inviterDisplayName: "本人",
      inviteeDisplayName: "美咲",
      relationshipCategory: "partner",
      status: "accepted",
      expiresAt: new Date(),
      acceptedAt: new Date(),
      cancelledAt: null,
      endedAt: null,
      endedByAccountId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const compatibilityData = {
      getByName: vi.fn(() => ({ getRelationship })),
    } as unknown as CompatibilityDataNamespace;
    const cf = { do: { accountData, compatibilityData } } as unknown as CloudflareBindings;

    await expect(loadSharedRelationshipContexts(cf, "account-1")).resolves.toEqual([
      { relationshipCategory: "partner", partnerDisplayName: "美咲" },
    ]);
    expect(getRelationship).toHaveBeenCalledWith("relationship-1", "account-1");
    expect(JSON.stringify(await loadSharedRelationshipContexts(cf, "account-1"))).not.toContain(
      "account-2",
    );
  });

  it("bindingがない環境では空Contextへ縮退する", async () => {
    const cf = { do: {} } as unknown as CloudflareBindings;
    await expect(loadSharedRelationshipContexts(cf, "account-1")).resolves.toEqual([]);
  });
});
