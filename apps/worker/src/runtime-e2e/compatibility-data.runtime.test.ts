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

    await expect(stub.endRelationship(relationshipId, inviterAccountId)).resolves.toMatchObject({
      outcome: "ended",
    });
    await expect(
      stub.synchronizeProgression(relationshipId, inviteeAccountId, themes),
    ).resolves.toBeNull();
    await runInDurableObject(stub, async (instance: CompatibilityData, state) => {
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

      // 修正前に終了済みだったObjectも、次の起動時に全共有詳細を消せることを確認する。
      state.storage.sql.exec(
        "UPDATE compatibility_relationships SET offered_profile_summary_version_id = 'old-version', offered_profile_fingerprint = 'old-offered', offered_profile_consented_at = 1, accepted_profile_summary_version_id = 'old-version', accepted_profile_fingerprint = 'old-accepted', accepted_profile_consented_at = 1",
      );
      state.storage.sql.exec(
        "INSERT INTO compatibility_offered_themes (relationship_id, diagnosis_id, result_fingerprint, consented_at) VALUES (?, 'old-theme', 'old-offered', 1)",
        relationshipId,
      );
      state.storage.sql.exec(
        "INSERT INTO compatibility_accepted_themes (relationship_id, diagnosis_id, result_fingerprint, consented_at) VALUES (?, 'old-theme', 'old-accepted', 1)",
        relationshipId,
      );
      state.storage.sql.exec(
        "INSERT INTO compatibility_progression_themes (diagnosis_id, result_fingerprint, first_compared_at, updated_at) VALUES ('old-theme', 'old-progression', 1, 1)",
      );
      state.storage.sql.exec(
        "UPDATE compatibility_progression_states SET comparable_theme_count = 1",
      );
      const repository = Reflect.get(instance, "repository") as { initialize(): Promise<void> };
      await repository.initialize();

      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT (SELECT count(*) FROM compatibility_offered_themes) + (SELECT count(*) FROM compatibility_accepted_themes) + (SELECT count(*) FROM compatibility_progression_themes) AS count",
          )
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

  it("カテゴリ追加前の既存共有を終端化してふたり進行度schemaまで移行できる", async () => {
    const relationshipId = createCompatibilityRelationshipId();
    const inviterAccountId = crypto.randomUUID();
    const inviteeAccountId = crypto.randomUUID();
    const stub = env.COMPATIBILITY_DATA.getByName(relationshipId);
    await stub.createInvitation(relationshipId, {
      inviterAccountId,
      inviterDisplayName: "送信者",
      relationshipCategory: "friend",
    });

    await runInDurableObject(stub, async (instance: CompatibilityData, state) => {
      state.storage.sql.exec(
        "UPDATE compatibility_relationships SET invitee_account_id = ?, invitee_display_name = '受信者', offered_profile_summary_version_id = 'offered-version', offered_profile_fingerprint = 'offered-fingerprint', offered_profile_consented_at = 1, accepted_profile_summary_version_id = 'accepted-version', accepted_profile_fingerprint = 'accepted-fingerprint', accepted_profile_consented_at = 1, status = 'accepted', accepted_at = 1",
        inviteeAccountId,
      );
      state.storage.sql.exec(
        "INSERT INTO compatibility_offered_themes (relationship_id, diagnosis_id, result_fingerprint, consented_at) VALUES (?, 'legacy-theme', 'offered-fingerprint', 1)",
        relationshipId,
      );
      state.storage.sql.exec(
        "INSERT INTO compatibility_accepted_themes (relationship_id, diagnosis_id, result_fingerprint, consented_at) VALUES (?, 'legacy-theme', 'accepted-fingerprint', 1)",
        relationshipId,
      );
      state.storage.sql.exec(
        "ALTER TABLE compatibility_relationships DROP COLUMN relationship_category",
      );
      state.storage.sql.exec("DROP TABLE compatibility_progression_themes");
      state.storage.sql.exec("DROP TABLE compatibility_progression_states");
      state.storage.sql.exec("DELETE FROM __drizzle_migrations WHERE created_at >= 1786667172848");
      const repository = Reflect.get(instance, "repository") as {
        backUpRelationshipBeforeCategoryMigration(): void;
        initialize(): Promise<void>;
      };

      // 退避直後にObjectが停止しても、次回initializeで同じ退避内容から再開できる。
      repository.backUpRelationshipBeforeCategoryMigration();
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT count(*) AS count FROM compatibility_relationships")
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT count(*) AS count FROM compatibility_relationship_category_recovery",
          )
          .one().count,
      ).toBe(1);

      await expect(repository.initialize()).resolves.toBeUndefined();

      expect(
        state.storage.sql
          .exec<{
            relationship_id: string;
            relationship_category: string;
            status: string;
          }>(
            "SELECT relationship_id, relationship_category, status FROM compatibility_relationships",
          )
          .one(),
      ).toEqual({
        relationship_id: relationshipId,
        relationship_category: "friend",
        status: "ended",
      });
      expect(
        state.storage.sql
          .exec<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'compatibility_progression_states'",
          )
          .one().name,
      ).toBe("compatibility_progression_states");
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT (SELECT count(*) FROM compatibility_offered_themes) + (SELECT count(*) FROM compatibility_accepted_themes) AS count",
          )
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
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'compatibility_relationship_category_recovery'",
          )
          .one().count,
      ).toBe(0);
      await expect(
        instance.getInvitationPreview(relationshipId, inviterAccountId),
      ).resolves.toBeNull();
      await expect(instance.getRelationship(relationshipId, inviteeAccountId)).resolves.toBeNull();
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
