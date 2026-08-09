import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  acceptCompatibilityInvitationWithReferences,
  accountDataFor,
  createCompatibilityRelationshipId,
} from "@me-builder/lib";
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

  it("accepted更新後に残ったreserved参照を一覧取得でactiveへ復旧する", async () => {
    const relationshipId = createCompatibilityRelationshipId();
    const inviterAccountId = crypto.randomUUID();
    const inviteeAccountId = crypto.randomUUID();
    const relationship = env.COMPATIBILITY_DATA.getByName(relationshipId);
    const inviter = accountDataFor(env.ACCOUNT_DATA, inviterAccountId);
    const invitee = accountDataFor(env.ACCOUNT_DATA, inviteeAccountId);

    await relationship.createInvitation(relationshipId, {
      inviterAccountId,
      inviterDisplayName: "送信者",
      offeredThemes: [{ diagnosisId: "diagnosis-1", resultFingerprint: "a".repeat(64) }],
    });
    await inviter.execute("compatibility.addOutgoingReference", {
      relationshipId,
      createdAt: new Date(),
    });
    await inviter.execute("compatibility.reserveOutgoingReference", {
      relationshipId,
      partnerAccountId: inviteeAccountId,
      updatedAt: new Date(),
    });
    await invitee.execute("compatibility.reserveIncomingReference", {
      relationshipId,
      partnerAccountId: inviterAccountId,
      createdAt: new Date(),
    });
    await relationship.acceptInvitation(relationshipId, {
      inviteeAccountId,
      inviteeDisplayName: "受信者",
      acceptedThemes: [{ diagnosisId: "diagnosis-1", resultFingerprint: "b".repeat(64) }],
    });

    await expect(invitee.execute("compatibility.listVisibleReferences")).resolves.toEqual([
      expect.objectContaining({ relationshipId, status: "active" }),
    ]);
    await expect(inviter.execute("compatibility.listVisibleReferences")).resolves.toEqual([
      expect.objectContaining({ relationshipId, status: "active" }),
    ]);
  });

  it("逆向きの招待を同時承諾しても同じAccountペアを1関係だけacceptedにする", async () => {
    const accountA = crypto.randomUUID();
    const accountB = crypto.randomUUID();
    const relationshipAtoB = createCompatibilityRelationshipId();
    const relationshipBtoA = createCompatibilityRelationshipId();
    const aData = accountDataFor(env.ACCOUNT_DATA, accountA);
    const bData = accountDataFor(env.ACCOUNT_DATA, accountB);
    const aToB = env.COMPATIBILITY_DATA.getByName(relationshipAtoB);
    const bToA = env.COMPATIBILITY_DATA.getByName(relationshipBtoA);

    await Promise.all([
      aToB.createInvitation(relationshipAtoB, {
        inviterAccountId: accountA,
        inviterDisplayName: "A",
        offeredThemes: [{ diagnosisId: "diagnosis-1", resultFingerprint: "a".repeat(64) }],
      }),
      bToA.createInvitation(relationshipBtoA, {
        inviterAccountId: accountB,
        inviterDisplayName: "B",
        offeredThemes: [{ diagnosisId: "diagnosis-1", resultFingerprint: "b".repeat(64) }],
      }),
      aData.execute("compatibility.addOutgoingReference", {
        relationshipId: relationshipAtoB,
        createdAt: new Date(),
      }),
      bData.execute("compatibility.addOutgoingReference", {
        relationshipId: relationshipBtoA,
        createdAt: new Date(),
      }),
    ]);

    const results = await Promise.all([
      acceptCompatibilityInvitationWithReferences(
        env.ACCOUNT_DATA,
        env.COMPATIBILITY_DATA,
        relationshipAtoB,
        {
          inviteeAccountId: accountB,
          inviteeDisplayName: "B",
          acceptedThemes: [{ diagnosisId: "diagnosis-1", resultFingerprint: "b".repeat(64) }],
        },
      ),
      acceptCompatibilityInvitationWithReferences(
        env.ACCOUNT_DATA,
        env.COMPATIBILITY_DATA,
        relationshipBtoA,
        {
          inviteeAccountId: accountA,
          inviteeDisplayName: "A",
          acceptedThemes: [{ diagnosisId: "diagnosis-1", resultFingerprint: "a".repeat(64) }],
        },
      ),
    ]);

    expect(results.map(({ outcome }) => outcome).sort()).toEqual(["accepted", "duplicate"]);
    const [aReferences, bReferences] = await Promise.all([
      aData.execute("compatibility.listVisibleReferences"),
      bData.execute("compatibility.listVisibleReferences"),
    ]);
    const aActive = aReferences.filter(({ status }) => status === "active");
    const bActive = bReferences.filter(({ status }) => status === "active");
    expect(aActive).toHaveLength(1);
    expect(bActive).toHaveLength(1);
    expect(aActive[0]?.relationshipId).toBe(bActive[0]?.relationshipId);
  });
});
