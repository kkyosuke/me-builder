import {
  type AcceptCompatibilityInvitationInput,
  type AcceptCompatibilityInvitationResult,
  type CancelCompatibilityInvitationResult,
  type CompatibilityInvitationAcceptanceContext,
  type CompatibilityInvitationPreview,
  type CompatibilityRelationship,
  type CreateCompatibilityInvitationInput,
  type CreateCompatibilityInvitationResult,
  type EndCompatibilityRelationshipResult,
  createCompatibilityInvitationAcceptanceContext,
  createCompatibilityInvitationPreview,
  decideCompatibilityInvitationAcceptance,
  decideCompatibilityInvitationCancellation,
  decideCompatibilityInvitationCreation,
  decideCompatibilityRelationshipEnd,
  expireCompatibilityRelationship,
  getAcceptedCompatibilityRelationship,
} from "@me-builder/lib";
import { eq } from "drizzle-orm";
import { type DrizzleSqliteDODatabase, drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../../drizzle/compatibility-data/migrations.js";
import { compatibilityDataSchema, compatibilityRelationships } from "./schema";

type CompatibilityDatabase = DrizzleSqliteDODatabase<typeof compatibilityDataSchema>;

export class CompatibilityDataRepository {
  private readonly db: CompatibilityDatabase;

  constructor(storage: DurableObjectStorage) {
    this.db = drizzle(storage, { schema: compatibilityDataSchema });
  }

  async initialize(): Promise<void> {
    await migrate(this.db, migrations);
  }

  createInvitation(
    relationshipId: string,
    input: CreateCompatibilityInvitationInput,
    createdAt: Date,
  ): CreateCompatibilityInvitationResult {
    const existing = this.readRelationship();
    const decision = decideCompatibilityInvitationCreation(
      existing,
      relationshipId,
      input,
      createdAt,
    );
    if (decision.outcome === "unchanged") return decision;
    const { relationship } = decision;

    this.db
      .insert(compatibilityRelationships)
      .values({
        singleton: 1,
        relationshipId: relationship.id,
        inviterAccountId: relationship.inviterAccountId,
        inviteeAccountId: relationship.inviteeAccountId,
        inviterDisplayName: relationship.inviterDisplayName,
        inviteeDisplayName: relationship.inviteeDisplayName,
        status: relationship.status,
        expiresAt: relationship.expiresAt,
        acceptedAt: relationship.acceptedAt,
        cancelledAt: relationship.cancelledAt,
        endedAt: relationship.endedAt,
        endedByAccountId: relationship.endedByAccountId,
        createdAt: relationship.createdAt,
        updatedAt: relationship.updatedAt,
      })
      .run();

    const persisted = this.readRelationship();
    if (!persisted) throw new Error("Compatibility invitation was not persisted");
    return { outcome: "created", relationship: persisted };
  }

  getInvitationPreview(viewerAccountId: string, at: Date): CompatibilityInvitationPreview | null {
    this.expirePending(at);
    return createCompatibilityInvitationPreview(this.readRelationship(), viewerAccountId, at);
  }

  getInvitationAcceptanceContext(at: Date): CompatibilityInvitationAcceptanceContext | null {
    this.expirePending(at);
    return createCompatibilityInvitationAcceptanceContext(this.readRelationship(), at);
  }

  acceptInvitation(
    input: AcceptCompatibilityInvitationInput,
    acceptedAt: Date,
  ): AcceptCompatibilityInvitationResult {
    this.expirePending(acceptedAt);
    const relationship = this.readRelationship();
    const decision = decideCompatibilityInvitationAcceptance(relationship, input, acceptedAt);
    if (decision.outcome !== "accepted") return decision;
    const acceptedRelationship = decision.relationship;

    this.db
      .update(compatibilityRelationships)
      .set({
        inviteeAccountId: acceptedRelationship.inviteeAccountId,
        inviteeDisplayName: acceptedRelationship.inviteeDisplayName,
        status: acceptedRelationship.status,
        acceptedAt: acceptedRelationship.acceptedAt,
        updatedAt: acceptedRelationship.updatedAt,
      })
      .where(eq(compatibilityRelationships.singleton, 1))
      .run();

    const accepted = this.readRelationship();
    if (!accepted) throw new Error("Accepted compatibility relationship was not persisted");
    return { outcome: "accepted", relationship: accepted };
  }

  cancelInvitation(actorAccountId: string, at: Date): CancelCompatibilityInvitationResult {
    this.expirePending(at);
    const relationship = this.readRelationship();
    const decision = decideCompatibilityInvitationCancellation(relationship, actorAccountId, at);
    if (decision.outcome !== "cancelled") return decision;
    this.db
      .update(compatibilityRelationships)
      .set({
        status: decision.relationship.status,
        cancelledAt: decision.relationship.cancelledAt,
        updatedAt: decision.relationship.updatedAt,
      })
      .where(eq(compatibilityRelationships.singleton, 1))
      .run();
    const cancelled = this.readRelationship();
    if (!cancelled) throw new Error("Cancelled compatibility invitation was not persisted");
    return { outcome: "cancelled", relationship: cancelled };
  }

  getRelationship(actorAccountId: string, at: Date): CompatibilityRelationship | null {
    this.expirePending(at);
    return getAcceptedCompatibilityRelationship(this.readRelationship(), actorAccountId);
  }

  endRelationship(actorAccountId: string, at: Date): EndCompatibilityRelationshipResult {
    const relationship = this.readRelationship();
    const decision = decideCompatibilityRelationshipEnd(relationship, actorAccountId, at);
    if (decision.outcome !== "ended") return decision;
    this.db
      .update(compatibilityRelationships)
      .set({
        status: decision.relationship.status,
        endedAt: decision.relationship.endedAt,
        endedByAccountId: decision.relationship.endedByAccountId,
        updatedAt: decision.relationship.updatedAt,
      })
      .where(eq(compatibilityRelationships.singleton, 1))
      .run();
    const ended = this.readRelationship();
    if (!ended) throw new Error("Ended compatibility relationship was not persisted");
    return { outcome: "ended", relationship: ended };
  }

  expirePending(at: Date): boolean {
    const relationship = this.readRelationship();
    if (!relationship) return false;
    const expired = expireCompatibilityRelationship(relationship, at);
    if (expired === relationship) return false;
    this.db
      .update(compatibilityRelationships)
      .set({ status: expired.status, updatedAt: expired.updatedAt })
      .where(eq(compatibilityRelationships.singleton, 1))
      .run();
    return true;
  }

  private readRelationship(): CompatibilityRelationship | null {
    const relationship = this.db
      .select()
      .from(compatibilityRelationships)
      .where(eq(compatibilityRelationships.singleton, 1))
      .get();
    if (!relationship) return null;
    return {
      id: relationship.relationshipId,
      inviterAccountId: relationship.inviterAccountId,
      inviteeAccountId: relationship.inviteeAccountId,
      inviterDisplayName: relationship.inviterDisplayName,
      inviteeDisplayName: relationship.inviteeDisplayName,
      status: relationship.status,
      expiresAt: relationship.expiresAt,
      acceptedAt: relationship.acceptedAt,
      cancelledAt: relationship.cancelledAt,
      endedAt: relationship.endedAt,
      endedByAccountId: relationship.endedByAccountId,
      createdAt: relationship.createdAt,
      updatedAt: relationship.updatedAt,
    };
  }
}
