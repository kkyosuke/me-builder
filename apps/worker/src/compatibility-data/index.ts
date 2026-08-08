import { DurableObject } from "cloudflare:workers";
import type {
  AcceptCompatibilityInvitationInput,
  CreateCompatibilityInvitationInput,
} from "@me-builder/lib";
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
    const result = this.repository.createInvitation(relationshipId, input);
    if (result.relationship.status === "pending") {
      await this.ctx.storage.setAlarm(result.relationship.expiresAt);
    }
    return result;
  }

  async getInvitation(relationshipId: string, _viewerAccountId: string, at: Date) {
    this.assertRouting(relationshipId);
    return this.repository.getInvitation(at);
  }

  async acceptInvitation(relationshipId: string, input: AcceptCompatibilityInvitationInput) {
    this.assertRouting(relationshipId);
    const result = this.repository.acceptInvitation(input);
    if (result.outcome === "accepted" || result.outcome === "unchanged") {
      await this.ctx.storage.deleteAlarm();
    }
    return result;
  }

  async cancelInvitation(relationshipId: string, actorAccountId: string, at: Date) {
    this.assertRouting(relationshipId);
    const result = this.repository.cancelInvitation(actorAccountId, at);
    if (result.outcome === "cancelled" || result.outcome === "unchanged") {
      await this.ctx.storage.deleteAlarm();
    }
    return result;
  }

  async getRelationship(relationshipId: string, actorAccountId: string, at: Date) {
    this.assertRouting(relationshipId);
    return this.repository.getRelationship(actorAccountId, at);
  }

  async endRelationship(relationshipId: string, actorAccountId: string, at: Date) {
    this.assertRouting(relationshipId);
    return this.repository.endRelationship(actorAccountId, at);
  }

  async alarm(): Promise<void> {
    this.repository.expirePending(new Date());
  }

  private assertRouting(relationshipId: string): void {
    if (relationshipId !== this.relationshipId) {
      throw new Error("CompatibilityData RPC relationship does not match object name");
    }
  }
}
