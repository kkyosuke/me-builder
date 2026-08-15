import { DurableObject } from "cloudflare:workers";
import {
  type AcceptCompatibilityInvitationInput,
  type CompatibilityPairThemeFingerprint,
  type CompatibilityRelationship,
  type CreateCompatibilityInvitationInput,
  accountDataFor,
  compatibilityDataFor,
} from "@me-builder/lib";
import { logger, toSafeOperationalErrorFields } from "@me-builder/shared";
import type { Env } from "../types";
import { CompatibilityDataRepository } from "./repository";

const PROGRESSION_RESTORED_KEY = "pairProgressionRestoredV1";
const PROGRESSION_BASELINE_REQUIRED_KEY = "pairProgressionBaselineRequiredV1";
const PROGRESSION_RESTORE_ACTOR_KEY = "pairProgressionRestoreActorV1";
const ALARM_RETRY_MS = 30_000;

/** 1つの招待と、成立後の1対1相性関係をprivate SQLiteに保存する。 */
export class CompatibilityData extends DurableObject<Env> {
  private readonly relationshipId: string;
  private readonly repository: CompatibilityDataRepository;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const relationshipId = ctx.id.name;
    if (!relationshipId)
      throw new Error("CompatibilityData must be addressed by relationship name");
    this.relationshipId = relationshipId;
    this.repository = new CompatibilityDataRepository(ctx.storage);
    ctx.blockConcurrencyWhile(async () => this.repository.initialize());
  }

  async createInvitation(relationshipId: string, input: CreateCompatibilityInvitationInput) {
    this.assertRouting(relationshipId);
    const result = this.repository.createInvitation(relationshipId, input, new Date());
    if (result.relationship.status === "pending") {
      await this.ctx.storage.setAlarm(result.relationship.expiresAt);
    }
    return result;
  }

  async getInvitationPreview(relationshipId: string, viewerAccountId: string) {
    this.assertRouting(relationshipId);
    return this.repository.getInvitationPreview(viewerAccountId, new Date());
  }

  async getInvitationAcceptanceContext(relationshipId: string) {
    this.assertRouting(relationshipId);
    return this.repository.getInvitationAcceptanceContext(new Date());
  }

  async acceptInvitation(relationshipId: string, input: AcceptCompatibilityInvitationInput) {
    this.assertRouting(relationshipId);
    const context = this.repository.getInvitationAcceptanceContext(new Date());
    if (context && context.inviterAccountId !== input.inviteeAccountId) {
      const namespace = this.env.ACCOUNT_DATA;
      if (!namespace) throw new Error("AccountData binding is required");
      const inviter = accountDataFor(namespace, context.inviterAccountId);
      const invitee = accountDataFor(namespace, input.inviteeAccountId);
      const [inviterReserved, inviteeReserved] = await Promise.all([
        inviter.execute("compatibility.hasReservation", {
          relationshipId,
          partnerAccountId: input.inviteeAccountId,
          role: "inviter",
        }),
        invitee.execute("compatibility.hasReservation", {
          relationshipId,
          partnerAccountId: context.inviterAccountId,
          role: "invitee",
        }),
      ]);
      if (!inviterReserved || !inviteeReserved) return { outcome: "unreserved" as const };
    }
    const result = this.repository.acceptInvitation(input, new Date());
    if (result.outcome === "accepted" || result.outcome === "unchanged") {
      await this.ctx.storage.deleteAlarm();
    }
    return result;
  }

  async cancelInvitation(relationshipId: string, actorAccountId: string) {
    this.assertRouting(relationshipId);
    const result = this.repository.cancelInvitation(actorAccountId, new Date());
    if (result.outcome === "cancelled" || result.outcome === "unchanged") {
      await this.ctx.storage.deleteAlarm();
    }
    return result;
  }

  async getRelationship(relationshipId: string, actorAccountId: string) {
    this.assertRouting(relationshipId);
    return this.repository.getRelationship(actorAccountId, new Date());
  }

  async synchronizeProgression(
    relationshipId: string,
    actorAccountId: string,
    themes: readonly CompatibilityPairThemeFingerprint[],
  ) {
    this.assertRouting(relationshipId);
    const at = new Date();
    const relationship = this.repository.getRelationship(actorAccountId, at);
    if (!relationship) return null;
    await this.ensureProgressionRestored(relationship, actorAccountId, at);
    const establishBaseline =
      (await this.ctx.storage.get<boolean>(PROGRESSION_BASELINE_REQUIRED_KEY)) === true;
    const progression = this.repository.synchronizeProgression(
      actorAccountId,
      themes,
      at,
      establishBaseline,
    );
    if (progression && establishBaseline) {
      await this.ctx.storage.delete(PROGRESSION_BASELINE_REQUIRED_KEY);
    }
    return progression;
  }

  async getEndedProgressionArchive(
    relationshipId: string,
    actorAccountId: string,
    relationshipCategory: CompatibilityRelationship["relationshipCategory"],
  ) {
    this.assertRouting(relationshipId);
    return this.repository.getEndedProgressionArchive(actorAccountId, relationshipCategory);
  }

  async endRelationship(relationshipId: string, actorAccountId: string) {
    this.assertRouting(relationshipId);
    return this.repository.endRelationship(actorAccountId, new Date());
  }

  async alarm(): Promise<void> {
    // 起動ログを止めているため、失敗を記録できる境界はここしかない。
    // 記録したうえで再送出し、Cloudflareのalarm再試行は従来どおり効かせる。
    try {
      this.repository.expirePending(new Date());
      const actorAccountId = await this.ctx.storage.get<string>(PROGRESSION_RESTORE_ACTOR_KEY);
      if (actorAccountId) {
        const at = new Date();
        const relationship = this.repository.getRelationship(actorAccountId, at);
        if (relationship) {
          await this.ensureProgressionRestored(relationship, actorAccountId, at);
        } else {
          await this.ctx.storage.delete(PROGRESSION_RESTORE_ACTOR_KEY);
        }
      }
    } catch (error) {
      logger.error(
        {
          event: "alarm.run.failed",
          service: "worker",
          component: "compatibility-data",
          outcome: "failed",
          disposition: "alarm-retry",
          ...toSafeOperationalErrorFields(error, {
            code: "COMPATIBILITY_DATA_ALARM_FAILED",
            category: "unknown",
            stage: "alarm.maintain-compatibility",
            retryable: true,
          }),
        },
        "[CompatibilityData] alarm failed at alarm.maintain-compatibility -> alarm-retry",
      );
      throw error;
    }
  }

  private async ensureProgressionRestored(
    relationship: CompatibilityRelationship,
    actorAccountId: string,
    at: Date,
  ): Promise<void> {
    if ((await this.ctx.storage.get<boolean>(PROGRESSION_RESTORED_KEY)) === true) return;
    const inviteeAccountId = relationship.inviteeAccountId;
    if (!inviteeAccountId) {
      throw new Error("Accepted compatibility relationship must have both participants");
    }
    const partnerAccountId =
      actorAccountId === relationship.inviterAccountId
        ? inviteeAccountId
        : relationship.inviterAccountId;
    try {
      const accountNamespace = this.env.ACCOUNT_DATA;
      const compatibilityNamespace = this.env.COMPATIBILITY_DATA;
      if (!accountNamespace || !compatibilityNamespace) {
        throw new Error("Pair progression restoration bindings are required");
      }
      const endedReferences = await accountDataFor(accountNamespace, actorAccountId).execute(
        "compatibility.listEndedReferencesForPartner",
        partnerAccountId,
      );
      const archives = await Promise.all(
        endedReferences
          .filter(({ relationshipId }) => relationshipId !== relationship.id)
          .map(({ relationshipId }) =>
            compatibilityDataFor(compatibilityNamespace, relationshipId).getEndedProgressionArchive(
              actorAccountId,
              relationship.relationshipCategory,
            ),
          ),
      );
      const archive = archives.reduce<Readonly<{
        growthValue: number;
        highestLevel: number;
      }> | null>((merged, candidate) => {
        if (!candidate) return merged;
        return {
          growthValue: Math.max(merged?.growthValue ?? 0, candidate.growthValue),
          highestLevel: Math.max(merged?.highestLevel ?? 1, candidate.highestLevel),
        };
      }, null);
      if (archive) {
        const restored = this.repository.restoreProgressionArchive(actorAccountId, archive, at);
        if (restored.baselineRequired) {
          await this.ctx.storage.put(PROGRESSION_BASELINE_REQUIRED_KEY, true);
        }
      }
      await this.ctx.storage.put(PROGRESSION_RESTORED_KEY, true);
      await this.ctx.storage.delete(PROGRESSION_RESTORE_ACTOR_KEY);
      await this.ctx.storage.deleteAlarm();
    } catch (error) {
      await this.ctx.storage.put(PROGRESSION_RESTORE_ACTOR_KEY, actorAccountId);
      await this.ctx.storage.setAlarm(new Date(Date.now() + ALARM_RETRY_MS));
      throw error;
    }
  }

  private assertRouting(relationshipId: string): void {
    if (relationshipId !== this.relationshipId) {
      throw new Error("CompatibilityData RPC relationship does not match object name");
    }
  }
}
