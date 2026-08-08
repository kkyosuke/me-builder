import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createCompatibilityRelationshipId } from "@me-builder/lib";
import { describe, expect, it } from "vitest";
import type { CompatibilityData } from "../compatibility-data";

describe("CompatibilityData Workers runtime E2E", () => {
  it("関係ごとのSQLiteへ招待と同意を保存し、別名でroutingされたRPCを拒否する", async () => {
    const relationshipId = createCompatibilityRelationshipId();
    const createdAt = new Date("2026-08-09T00:00:00.000Z");
    const acceptedAt = new Date("2026-08-10T00:00:00.000Z");
    const stub = env.COMPATIBILITY_DATA.getByName(relationshipId);

    await expect(
      stub.createInvitation(relationshipId, {
        inviterAccountId: crypto.randomUUID(),
        inviterDisplayName: "送信者",
        offeredThemes: [
          {
            diagnosisId: "diagnosis-1",
            resultFingerprint: "a".repeat(64),
            consentedAt: createdAt,
          },
        ],
        expiresAt: new Date("2026-08-23T00:00:00.000Z"),
        createdAt,
      }),
    ).resolves.toMatchObject({ outcome: "created", relationship: { status: "pending" } });

    const invitation = await stub.getInvitation(relationshipId, crypto.randomUUID(), createdAt);
    expect(invitation).toMatchObject({
      id: relationshipId,
      inviteeAccountId: null,
      acceptedThemes: [],
    });

    await expect(
      stub.acceptInvitation(relationshipId, {
        inviteeAccountId: crypto.randomUUID(),
        inviteeDisplayName: "受信者",
        acceptedThemes: [
          {
            diagnosisId: "diagnosis-1",
            resultFingerprint: "b".repeat(64),
            consentedAt: acceptedAt,
          },
        ],
        acceptedAt,
      }),
    ).resolves.toMatchObject({ outcome: "accepted", relationship: { status: "accepted" } });

    await runInDurableObject(stub, async (instance: CompatibilityData, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT count(*) AS count FROM compatibility_relationships")
          .one().count,
      ).toBe(1);
      await expect(
        instance.getRelationship("another-relationship", "account", acceptedAt),
      ).rejects.toThrow("CompatibilityData RPC relationship does not match object name");
    });
  });
});
