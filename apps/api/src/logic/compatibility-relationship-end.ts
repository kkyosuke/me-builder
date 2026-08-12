import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type D1,
  endCompatibilityRelationshipWithReferences,
} from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

const RELATIONSHIP_ID_PATTERN = /^[a-f0-9]{64}$/;

type Params = Readonly<{
  relationshipId: string;
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData: AccountDataNamespace;
  compatibilityData: CompatibilityDataNamespace;
}>;

export type EndCompatibilityRelationshipOutcome =
  | { type: "ended" }
  | { type: "unavailable" }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

/** 本人確認後に正本と双方の一覧参照を終了する。 */
export async function endCompatibilityRelationship(
  params: Params,
): Promise<EndCompatibilityRelationshipOutcome> {
  const session = await createLiffSession(params);
  if (session.type !== "resolved") return session;
  if (!RELATIONSHIP_ID_PATTERN.test(params.relationshipId)) return { type: "unavailable" };
  const result = await endCompatibilityRelationshipWithReferences(
    params.accountData,
    params.compatibilityData,
    params.relationshipId,
    session.session.accountId,
  );
  return result.outcome === "ended" || result.outcome === "unchanged"
    ? { type: "ended" }
    : { type: "unavailable" };
}
