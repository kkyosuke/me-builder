import {
  type AcceptCompatibilityInvitationInput,
  type AcceptCompatibilityInvitationResult,
  type CompatibilityDataNamespace,
  type CompatibilityRelationship,
  type CreateCompatibilityInvitationInput,
  type CreateCompatibilityInvitationResult,
  compatibilityDataFor,
  createCompatibilityRelationshipId,
} from "./compatibility-data";
import { type AccountDataNamespace, accountDataFor } from "./do/account/rpc";

export type CreateCompatibilityInvitationWithReferenceResult = CreateCompatibilityInvitationResult;

/** 正本の招待を作成し、送信者の一覧参照まで保存してから発行成功とする。 */
export async function createCompatibilityInvitationWithReference(
  accountNamespace: AccountDataNamespace,
  compatibilityNamespace: CompatibilityDataNamespace,
  input: CreateCompatibilityInvitationInput,
  relationshipId = createCompatibilityRelationshipId(),
): Promise<CreateCompatibilityInvitationWithReferenceResult> {
  const relationshipData = compatibilityDataFor(compatibilityNamespace, relationshipId);
  const result = await relationshipData.createInvitation(input);
  try {
    await accountDataFor(accountNamespace, input.inviterAccountId).execute(
      "compatibility.addOutgoingReference",
      {
        relationshipId,
        createdAt: result.relationship.createdAt,
      },
    );
  } catch (error) {
    // URLを返す前の失敗では正本を取消し、参照のない利用可能な招待を残さない。
    await relationshipData.cancelInvitation(input.inviterAccountId).catch(() => undefined);
    throw error;
  }
  return result;
}

export type AcceptCompatibilityInvitationWithReferencesResult =
  | AcceptCompatibilityInvitationResult
  | Readonly<{ outcome: "duplicate" }>;

type ReservationStep = Readonly<{
  accountId: string;
  reserve: () => Promise<{ outcome: "reserved" | "unchanged" | "conflict" }>;
  release: () => Promise<unknown>;
}>;

function compareAccountIds(left: { accountId: string }, right: { accountId: string }): number {
  if (left.accountId === right.accountId) return 0;
  return left.accountId < right.accountId ? -1 : 1;
}

function createReservationSteps(
  namespace: AccountDataNamespace,
  relationshipId: string,
  inviterAccountId: string,
  inviteeAccountId: string,
  at: Date,
): ReservationStep[] {
  const inviter = accountDataFor(namespace, inviterAccountId);
  const invitee = accountDataFor(namespace, inviteeAccountId);
  return [
    {
      accountId: inviterAccountId,
      reserve: () =>
        inviter.execute("compatibility.reserveOutgoingReference", {
          relationshipId,
          partnerAccountId: inviteeAccountId,
          updatedAt: at,
        }),
      release: () => inviter.execute("compatibility.releaseReservation", relationshipId, at),
    },
    {
      accountId: inviteeAccountId,
      reserve: () =>
        invitee.execute("compatibility.reserveIncomingReference", {
          relationshipId,
          partnerAccountId: inviterAccountId,
          createdAt: at,
        }),
      release: () => invitee.execute("compatibility.releaseReservation", relationshipId, at),
    },
  ].sort(compareAccountIds);
}

async function releaseReservations(steps: readonly ReservationStep[]): Promise<void> {
  const results = await Promise.allSettled(steps.map(({ release }) => release()));
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
}

async function activateCompatibilityReferences(
  namespace: AccountDataNamespace,
  relationshipId: string,
  inviterAccountId: string,
  inviteeAccountId: string,
): Promise<void> {
  const participants = [
    { accountId: inviterAccountId, partnerAccountId: inviteeAccountId, role: "inviter" as const },
    { accountId: inviteeAccountId, partnerAccountId: inviterAccountId, role: "invitee" as const },
  ].sort(compareAccountIds);
  for (const participant of participants) {
    const activation = await accountDataFor(namespace, participant.accountId).execute(
      "compatibility.activateReference",
      {
        relationshipId,
        partnerAccountId: participant.partnerAccountId,
        role: participant.role,
        updatedAt: new Date(),
      },
    );
    if (activation.outcome === "conflict") {
      throw new Error("Compatibility pair reservation was lost before activation");
    }
  }
}

/** 同じAccountペアの承諾を双方のAccountDataで直列化してから正本を更新する。 */
export async function acceptCompatibilityInvitationWithReferences(
  accountNamespace: AccountDataNamespace,
  compatibilityNamespace: CompatibilityDataNamespace,
  relationshipId: string,
  input: AcceptCompatibilityInvitationInput,
): Promise<AcceptCompatibilityInvitationWithReferencesResult> {
  const relationshipData = compatibilityDataFor(compatibilityNamespace, relationshipId);
  const context = await relationshipData.getInvitationAcceptanceContext();
  if (!context) {
    const result = await relationshipData.acceptInvitation(input);
    if (result.outcome === "accepted" || result.outcome === "unchanged") {
      const inviteeAccountId = result.relationship.inviteeAccountId;
      if (!inviteeAccountId) {
        throw new Error("Accepted compatibility relationship must have both participants");
      }
      await activateCompatibilityReferences(
        accountNamespace,
        relationshipId,
        result.relationship.inviterAccountId,
        inviteeAccountId,
      );
    }
    return result;
  }
  if (context.inviterAccountId === input.inviteeAccountId) {
    return relationshipData.acceptInvitation(input);
  }

  const at = new Date();
  const steps = createReservationSteps(
    accountNamespace,
    relationshipId,
    context.inviterAccountId,
    input.inviteeAccountId,
    at,
  );
  try {
    for (const step of steps) {
      const reservation = await step.reserve();
      if (reservation.outcome === "conflict") {
        await releaseReservations(steps);
        return { outcome: "duplicate" };
      }
    }
  } catch (error) {
    await releaseReservations(steps);
    throw error;
  }

  let result: AcceptCompatibilityInvitationResult;
  try {
    result = await relationshipData.acceptInvitation(input);
  } catch (error) {
    // RPC応答だけ失敗した可能性があるため、正本がacceptedなら予約を保持して同期する。
    let accepted: CompatibilityRelationship | null;
    try {
      accepted = await relationshipData.getRelationship(input.inviteeAccountId);
    } catch {
      // 正本の更新有無が不明な場合は予約を残し、再試行または一覧同期へ委ねる。
      throw error;
    }
    if (!accepted) await releaseReservations(steps);
    throw error;
  }
  if (result.outcome !== "accepted" && result.outcome !== "unchanged") {
    await releaseReservations(steps);
    return result;
  }

  await activateCompatibilityReferences(
    accountNamespace,
    relationshipId,
    context.inviterAccountId,
    input.inviteeAccountId,
  );
  return result;
}

/** 正本の招待を取り消してから、送信者の一覧参照を冪等に非表示へ更新する。 */
export async function cancelCompatibilityInvitationWithReference(
  accountNamespace: AccountDataNamespace,
  compatibilityNamespace: CompatibilityDataNamespace,
  relationshipId: string,
  actorAccountId: string,
) {
  const result = await compatibilityDataFor(
    compatibilityNamespace,
    relationshipId,
  ).cancelInvitation(actorAccountId);
  if (result.outcome === "cancelled" || result.outcome === "unchanged") {
    const { cancelledAt } = result.relationship;
    if (!cancelledAt) {
      throw new Error("Cancelled compatibility invitation must have cancelledAt");
    }
    await accountDataFor(accountNamespace, actorAccountId).execute(
      "compatibility.endReference",
      relationshipId,
      cancelledAt,
    );
  }
  return result;
}

/** 正本の関係を終了してから、双方の一覧参照を冪等に非表示へ更新する。 */
export async function endCompatibilityRelationshipWithReferences(
  accountNamespace: AccountDataNamespace,
  compatibilityNamespace: CompatibilityDataNamespace,
  relationshipId: string,
  actorAccountId: string,
) {
  const result = await compatibilityDataFor(compatibilityNamespace, relationshipId).endRelationship(
    actorAccountId,
  );
  if (result.outcome === "ended" || result.outcome === "unchanged") {
    const { endedAt, inviteeAccountId } = result.relationship;
    if (!inviteeAccountId || !endedAt) {
      throw new Error("Ended compatibility relationship must have both participants and endedAt");
    }
    const participantIds = [result.relationship.inviterAccountId, inviteeAccountId].sort();
    await Promise.all(
      participantIds.map((accountId) =>
        accountDataFor(accountNamespace, accountId).execute(
          "compatibility.endReference",
          relationshipId,
          endedAt,
        ),
      ),
    );
  }
  return result;
}
