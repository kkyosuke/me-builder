import { describe, expect, it } from "vitest";
import {
  createCompatibilityInvitationAcceptanceContext,
  createCompatibilityInvitationPreview,
  decideCompatibilityInvitationAcceptance,
  decideCompatibilityInvitationCancellation,
  decideCompatibilityInvitationCreation,
  decideCompatibilityRelationshipEnd,
  expireCompatibilityRelationship,
  getAcceptedCompatibilityRelationship,
} from "./compatibility-data-domain";

const relationshipId = "1".repeat(64);
const createdAt = new Date("2026-08-09T00:00:00.000Z");
const expiresAt = new Date("2026-08-23T00:00:00.000Z");

function invitationInput() {
  return {
    inviterAccountId: "account-inviter",
    inviterDisplayName: " 送信者 ",
    relationshipCategory: "partner",
  } as const;
}

function pendingRelationship() {
  const decision = decideCompatibilityInvitationCreation(
    null,
    relationshipId,
    invitationInput(),
    createdAt,
  );
  if (decision.outcome !== "created") throw new Error("Expected a created invitation");
  return decision.relationship;
}

describe("compatibility data domain", () => {
  it("招待の入力を検証し、14日期限と同意時刻をドメインで決める", () => {
    const relationship = pendingRelationship();

    expect(relationship).toMatchObject({
      id: relationshipId,
      inviterDisplayName: "送信者",
      relationshipCategory: "partner",
      status: "pending",
      createdAt,
      expiresAt,
    });
    expect(() =>
      decideCompatibilityInvitationCreation(
        null,
        relationshipId,
        { ...invitationInput(), inviterDisplayName: "  " },
        createdAt,
      ),
    ).toThrow("inviterDisplayName is required");
    expect(() =>
      decideCompatibilityInvitationCreation(
        null,
        relationshipId,
        { ...invitationInput(), relationshipCategory: "general" } as never,
        createdAt,
      ),
    ).toThrow("relationshipCategory must identify a specific relationship");
  });

  it("同じ招待commandを冪等に扱い、異なる送信者は競合として拒否する", () => {
    const relationship = pendingRelationship();

    expect(
      decideCompatibilityInvitationCreation(
        relationship,
        relationshipId,
        invitationInput(),
        new Date("2026-08-10T00:00:00.000Z"),
      ),
    ).toEqual({ outcome: "unchanged", relationship });
    expect(() =>
      decideCompatibilityInvitationCreation(
        relationship,
        relationshipId,
        { ...invitationInput(), inviterDisplayName: "別の名前" },
        createdAt,
      ),
    ).toThrow("conflicts with persisted relationship");
  });

  it("期限と招待previewを純粋な状態変換として扱う", () => {
    const relationship = pendingRelationship();

    expect(
      createCompatibilityInvitationPreview(relationship, "account-invitee", createdAt),
    ).toEqual({
      id: relationshipId,
      inviterDisplayName: "送信者",
      relationshipCategory: "partner",
      expiresAt,
      isOwnInvitation: false,
    });
    expect(createCompatibilityInvitationAcceptanceContext(relationship, createdAt)).toEqual({
      inviterAccountId: "account-inviter",
      relationshipCategory: "partner",
      expiresAt,
    });
    expect(expireCompatibilityRelationship(relationship, new Date(expiresAt.getTime() - 1))).toBe(
      relationship,
    );
    const expired = expireCompatibilityRelationship(relationship, expiresAt);
    expect(expired.status).toBe("expired");
    expect(createCompatibilityInvitationPreview(expired, "account-invitee", expiresAt)).toBeNull();
    expect(
      createCompatibilityInvitationPreview(relationship, "account-invitee", expiresAt),
    ).toBeNull();
    expect(createCompatibilityInvitationAcceptanceContext(relationship, expiresAt)).toBeNull();
  });

  it("承諾・閲覧・終了の状態遷移と認可を判定する", () => {
    const relationship = pendingRelationship();
    const acceptedAt = new Date("2026-08-10T00:00:00.000Z");
    const acceptance = {
      inviteeAccountId: "account-invitee",
      inviteeDisplayName: " 受信者 ",
    } as const;
    const accepted = decideCompatibilityInvitationAcceptance(relationship, acceptance, acceptedAt);
    expect(accepted).toMatchObject({
      outcome: "accepted",
      relationship: {
        inviteeDisplayName: "受信者",
        status: "accepted",
        acceptedAt,
      },
    });
    if (accepted.outcome !== "accepted") throw new Error("Expected an accepted relationship");

    expect(
      decideCompatibilityInvitationAcceptance(accepted.relationship, acceptance, acceptedAt),
    ).toMatchObject({ outcome: "unchanged" });
    expect(
      decideCompatibilityInvitationAcceptance(
        accepted.relationship,
        { inviteeAccountId: "account-other", inviteeDisplayName: "別の人" },
        acceptedAt,
      ),
    ).toEqual({ outcome: "unavailable" });
    expect(
      getAcceptedCompatibilityRelationship(accepted.relationship, "account-outsider"),
    ).toBeNull();
    expect(getAcceptedCompatibilityRelationship(accepted.relationship, "account-invitee")).toBe(
      accepted.relationship,
    );

    const endedAt = new Date("2026-08-11T00:00:00.000Z");
    expect(
      decideCompatibilityRelationshipEnd(accepted.relationship, "account-inviter", endedAt),
    ).toMatchObject({
      outcome: "ended",
      relationship: { status: "ended", endedByAccountId: "account-inviter", endedAt },
    });
  });

  it("永続状態がpendingのままでも期限後の承諾をドメインで拒否する", () => {
    const relationship = pendingRelationship();
    expect(
      decideCompatibilityInvitationAcceptance(
        relationship,
        { inviteeAccountId: "account-invitee", inviteeDisplayName: "受信者" },
        expiresAt,
      ),
    ).toEqual({ outcome: "expired" });
    expect(
      decideCompatibilityInvitationCancellation(relationship, "account-inviter", expiresAt),
    ).toEqual({ outcome: "unavailable" });
  });

  it("取消は送信者だけに許可する", () => {
    const relationship = pendingRelationship();
    const cancelledAt = new Date("2026-08-10T00:00:00.000Z");

    expect(
      decideCompatibilityInvitationCancellation(relationship, "account-outsider", cancelledAt),
    ).toEqual({ outcome: "forbidden" });
    expect(
      decideCompatibilityInvitationCancellation(relationship, "account-inviter", cancelledAt),
    ).toMatchObject({
      outcome: "cancelled",
      relationship: { status: "cancelled", cancelledAt },
    });
  });
});
