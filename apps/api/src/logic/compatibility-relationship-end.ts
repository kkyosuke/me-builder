import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type D1,
  compatibilityRelationshipId,
  endCompatibilityRelationshipWithReferences,
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

export type EndCompatibilityRelationshipOutcome =
  | { type: "ended" }
  | { type: "unavailable" }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Dependencies = Readonly<{
  createSession: typeof createLiffSession;
  endRelationship: typeof endCompatibilityRelationshipWithReferences;
}>;

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  endRelationship: endCompatibilityRelationshipWithReferences,
};

/** 本人確認後に正本と双方の一覧参照を終了する。 */
export async function endCompatibilityRelationship(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<EndCompatibilityRelationshipOutcome> {
  if (!compatibilityRelationshipId.isValid(params.relationshipId)) return { type: "unavailable" };
  const session = await dependencies.createSession(params);
  if (session.type !== "resolved") return session;
  const result = await dependencies.endRelationship(
    params.accountData,
    params.compatibilityData,
    params.relationshipId,
    session.session.accountId,
  );
  return result.outcome === "ended" || result.outcome === "unchanged"
    ? { type: "ended" }
    : { type: "unavailable" };
}
