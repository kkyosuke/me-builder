import { DurableObject } from "cloudflare:workers";
import {
  type AcceptCompatibilityInvitationInput,
  type CompatibilityPairProgressionResumeSnapshot,
  type CompatibilityPairThemeFingerprint,
  type CreateCompatibilityInvitationInput,
  accountDataFor,
} from "@me-builder/lib";
import { logger, toSafeOperationalErrorFields } from "@me-builder/shared";
import type { Env } from "../types";
import { CompatibilityDataRepository } from "./repository";

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
    return this.repository.synchronizeProgression(actorAccountId, themes, new Date());
  }

  async hasProgressionState(relationshipId: string, actorAccountId: string) {
    this.assertRouting(relationshipId);
    return this.repository.hasProgressionState(actorAccountId, new Date());
  }

  async getProgressionResumeSnapshot(relationshipId: string, actorAccountId: string) {
    this.assertRouting(relationshipId);
    return this.repository.getProgressionResumeSnapshot(actorAccountId);
  }

  async restoreProgression(
    relationshipId: string,
    actorAccountId: string,
    snapshot: CompatibilityPairProgressionResumeSnapshot,
  ) {
    this.assertRouting(relationshipId);
    return this.repository.restoreProgression(actorAccountId, snapshot, new Date());
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
            stage: "alarm.expire-pending",
            retryable: true,
          }),
        },
        "[CompatibilityData] alarm failed at alarm.expire-pending -> alarm-retry (pending invitations were not expired)",
      );
      throw error;
    }
  }

  private assertRouting(relationshipId: string): void {
    if (relationshipId !== this.relationshipId) {
      throw new Error("CompatibilityData RPC relationship does not match object name");
    }
  }
}
