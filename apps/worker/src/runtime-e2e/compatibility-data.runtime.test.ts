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
    const inviterAccountId = crypto.randomUUID();
    const inviteeAccountId = crypto.randomUUID();
    const stub = env.COMPATIBILITY_DATA.getByName(relationshipId);
    const inviter = accountDataFor(env.ACCOUNT_DATA, inviterAccountId);
    const invitee = accountDataFor(env.ACCOUNT_DATA, inviteeAccountId);

    await expect(
      stub.createInvitation(relationshipId, {
        inviterAccountId,
        inviterDisplayName: "送信者",
        relationshipCategory: "partner",
      }),
    ).resolves.toMatchObject({ outcome: "created", relationship: { status: "pending" } });

    const invitation = await stub.getInvitationPreview(relationshipId, crypto.randomUUID());
    expect(invitation).toEqual({
      id: relationshipId,
      inviterDisplayName: "送信者",
      relationshipCategory: "partner",
      expiresAt: expect.any(Date),
      isOwnInvitation: false,
    });
    expect(invitation).not.toHaveProperty("inviterAccountId");
    await expect(stub.getInvitationAcceptanceContext(relationshipId)).resolves.toMatchObject({
      inviterAccountId,
    });

    const acceptance = {
      inviteeAccountId,
      inviteeDisplayName: "受信者",
    } as const;
    await expect(stub.acceptInvitation(relationshipId, acceptance)).resolves.toEqual({
      outcome: "unreserved",
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
    await expect(stub.acceptInvitation(relationshipId, acceptance)).resolves.toMatchObject({
      outcome: "accepted",
      relationship: { status: "accepted" },
    });
    const themes = [{ diagnosisId: "values", fingerprint: "sha256:first" }];
    await expect(
      stub.synchronizeProgression(relationshipId, inviterAccountId, themes),
    ).resolves.toMatchObject({ level: 2, growthValue: 3, marks: [2] });
    await expect(
      stub.synchronizeProgression(relationshipId, inviteeAccountId, themes),
    ).resolves.toMatchObject({ level: 2, growthValue: 3 });

    await runInDurableObject(stub, async (instance: CompatibilityData, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT count(*) AS count FROM compatibility_relationships")
          .one().count,
      ).toBe(1);
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT count(*) AS count FROM compatibility_progression_themes")
          .one().count,
      ).toBe(1);
      state.storage.sql.exec(
        "UPDATE compatibility_relationships SET offered_profile_summary_version_id = ?, offered_profile_fingerprint = ?, offered_profile_consented_at = ?, accepted_profile_summary_version_id = ?, accepted_profile_fingerprint = ?, accepted_profile_consented_at = ?",
        "offered-version",
        "offered-fingerprint",
        Date.now(),
        "accepted-version",
        "accepted-fingerprint",
        Date.now(),
      );
      state.storage.sql.exec(
        "INSERT INTO compatibility_offered_themes (relationship_id, diagnosis_id, result_fingerprint, consented_at) VALUES (?, ?, ?, ?)",
        relationshipId,
        "legacy-theme",
        "legacy-offered-fingerprint",
        Date.now(),
      );
      state.storage.sql.exec(
        "INSERT INTO compatibility_accepted_themes (relationship_id, diagnosis_id, result_fingerprint, consented_at) VALUES (?, ?, ?, ?)",
        relationshipId,
        "legacy-theme",
        "legacy-accepted-fingerprint",
        Date.now(),
      );
      await expect(instance.getRelationship("another-relationship", "account")).rejects.toThrow(
        "CompatibilityData RPC relationship does not match object name",
      );
    });

    await stub.endRelationship(relationshipId, inviterAccountId);
    await runInDurableObject(stub, async (_instance: CompatibilityData, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT count(*) AS count FROM compatibility_progression_themes")
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{
            growth_value: number;
            highest_level: number;
            comparable_theme_count: number;
          }>(
            "SELECT growth_value, highest_level, comparable_theme_count FROM compatibility_progression_states",
          )
          .one(),
      ).toEqual({ growth_value: 3, highest_level: 2, comparable_theme_count: 0 });
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT count(*) AS count FROM compatibility_offered_themes")
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT count(*) AS count FROM compatibility_accepted_themes")
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{
            offered_profile_fingerprint: string | null;
            accepted_profile_fingerprint: string | null;
          }>(
            "SELECT offered_profile_fingerprint, accepted_profile_fingerprint FROM compatibility_relationships",
          )
          .one(),
      ).toEqual({ offered_profile_fingerprint: null, accepted_profile_fingerprint: null });
    });
  });

  it("AccountData一覧を正本へ同期し、承諾済みをactive化して終了済みを除外する", async () => {
    const relationshipId = createCompatibilityRelationshipId();
    const inviterAccountId = crypto.randomUUID();
    const inviteeAccountId = crypto.randomUUID();
    const relationship = env.COMPATIBILITY_DATA.getByName(relationshipId);
    const inviter = accountDataFor(env.ACCOUNT_DATA, inviterAccountId);
    const invitee = accountDataFor(env.ACCOUNT_DATA, inviteeAccountId);

    await relationship.createInvitation(relationshipId, {
      inviterAccountId,
      inviterDisplayName: "送信者",
      relationshipCategory: "family",
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
      relationshipCategory: "friend",
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
      relationshipCategory: "work",
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
        relationshipCategory: "partner",
      }),
      bToA.createInvitation(relationshipBtoA, {
        inviterAccountId: accountB,
        inviterDisplayName: "B",
        relationshipCategory: "partner",
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
        },
      ),
      acceptCompatibilityInvitationWithReferences(
        env.ACCOUNT_DATA,
        env.COMPATIBILITY_DATA,
        relationshipBtoA,
        {
          inviteeAccountId: accountA,
          inviteeDisplayName: "A",
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
