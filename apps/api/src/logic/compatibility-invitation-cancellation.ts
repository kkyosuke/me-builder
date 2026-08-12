import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type D1,
  cancelCompatibilityInvitationWithReference,
  compatibilityRelationshipId,
} from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

type Params = Readonly<{
  relationshipId: string;
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData: AccountDataNamespace;
  compatibilityData: CompatibilityDataNamespace;
}>;

export type CancelCompatibilityInvitationOutcome =
  | { type: "cancelled" }
  | { type: "unavailable" }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

/** 本人確認後に正本と送信者の一覧参照を取り消す。 */
export async function cancelCompatibilityInvitation(
  params: Params,
): Promise<CancelCompatibilityInvitationOutcome> {
  if (!compatibilityRelationshipId.isValid(params.relationshipId)) return { type: "unavailable" };
  const session = await createLiffSession(params);
  if (session.type !== "resolved") return session;
  const result = await cancelCompatibilityInvitationWithReference(
    params.accountData,
    params.compatibilityData,
    params.relationshipId,
    session.session.accountId,
  );
  return result.outcome === "cancelled" || result.outcome === "unchanged"
    ? { type: "cancelled" }
    : { type: "unavailable" };
}
