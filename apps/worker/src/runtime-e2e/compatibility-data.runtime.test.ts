import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { accountDataFor, createCompatibilityRelationshipId } from "@me-builder/lib";
import { describe, expect, it } from "vitest";
import type { CompatibilityData } from "../compatibility-data";

describe("CompatibilityData Workers runtime E2E", () => {
  it("関係ごとのSQLiteへ招待と同意を保存し、別名でroutingされたRPCを拒否する", async () => {
    const relationshipId = createCompatibilityRelationshipId();
    const stub = env.COMPATIBILITY_DATA.getByName(relationshipId);

    await expect(
      stub.createInvitation(relationshipId, {
        inviterAccountId: crypto.randomUUID(),
        inviterDisplayName: "送信者",
        offeredThemes: [
          {
            diagnosisId: "diagnosis-1",
            resultFingerprint: "a".repeat(64),
          },
        ],
      }),
    ).resolves.toMatchObject({ outcome: "created", relationship: { status: "pending" } });

    const invitation = await stub.getInvitationPreview(relationshipId, crypto.randomUUID());
    expect(invitation).toEqual({
      id: relationshipId,
      inviterDisplayName: "送信者",
      offeredDiagnosisIds: ["diagnosis-1"],
      expiresAt: expect.any(Date),
      isOwnInvitation: false,
    });
    expect(invitation).not.toHaveProperty("inviterAccountId");
    expect(invitation).not.toHaveProperty("resultFingerprint");

    await expect(
      stub.acceptInvitation(relationshipId, {
        inviteeAccountId: crypto.randomUUID(),
        inviteeDisplayName: "受信者",
        acceptedThemes: [
          {
            diagnosisId: "diagnosis-1",
            resultFingerprint: "b".repeat(64),
          },
        ],
      }),
    ).resolves.toMatchObject({ outcome: "accepted", relationship: { status: "accepted" } });

    await runInDurableObject(stub, async (instance: CompatibilityData, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT count(*) AS count FROM compatibility_relationships")
          .one().count,
      ).toBe(1);
      await expect(instance.getRelationship("another-relationship", "account")).rejects.toThrow(
        "CompatibilityData RPC relationship does not match object name",
      );
    });
  });

  it("AccountData一覧を正本へ同期し、承諾済みをactive化して終了済みを除外する", async () => {
    const relationshipId = createCompatibilityRelationshipId();
    const inviterAccountId = crypto.randomUUID();
    const inviteeAccountId = crypto.randomUUID();
    const relationship = env.COMPATIBILITY_DATA.getByName(relationshipId);
    const inviter = accountDataFor(env.ACCOUNT_DATA, inviterAccountId);

    await relationship.createInvitation(relationshipId, {
      inviterAccountId,
      inviterDisplayName: "送信者",
      offeredThemes: [{ diagnosisId: "diagnosis-1", resultFingerprint: "a".repeat(64) }],
    });
    await inviter.execute("compatibility.addOutgoingReference", {
      relationshipId,
      createdAt: new Date(),
    });
    await relationship.acceptInvitation(relationshipId, {
      inviteeAccountId,
      inviteeDisplayName: "受信者",
      acceptedThemes: [{ diagnosisId: "diagnosis-1", resultFingerprint: "b".repeat(64) }],
    });

    await expect(inviter.execute("compatibility.listVisibleReferences")).resolves.toEqual([
      expect.objectContaining({
        relationshipId,
        partnerAccountId: inviteeAccountId,
        status: "active",
      }),
    ]);

    await relationship.endRelationship(relationshipId, inviteeAccountId);
    await expect(inviter.execute("compatibility.listVisibleReferences")).resolves.toEqual([]);
  });

  it("取り消されたpending参照を返事待ち一覧から除外する", async () => {
    const relationshipId = createCompatibilityRelationshipId();
    const inviterAccountId = crypto.randomUUID();
    const relationship = env.COMPATIBILITY_DATA.getByName(relationshipId);
    const inviter = accountDataFor(env.ACCOUNT_DATA, inviterAccountId);

    await relationship.createInvitation(relationshipId, {
      inviterAccountId,
      inviterDisplayName: "送信者",
      offeredThemes: [{ diagnosisId: "diagnosis-1", resultFingerprint: "a".repeat(64) }],
    });
    await inviter.execute("compatibility.addOutgoingReference", {
      relationshipId,
      createdAt: new Date(),
    });
    await relationship.cancelInvitation(relationshipId, inviterAccountId);

    await expect(inviter.execute("compatibility.listVisibleReferences")).resolves.toEqual([]);
  });
});
