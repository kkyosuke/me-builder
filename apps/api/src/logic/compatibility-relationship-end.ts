import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  compatibilityRelationshipId,
  endCompatibilityRelationshipWithReferences,
} from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";

type Params = Readonly<{
  relationshipId: string;
  actor: AuthenticatedActor;
  accountData: AccountDataNamespace;
  compatibilityData: CompatibilityDataNamespace;
}>;

export type EndCompatibilityRelationshipOutcome = { type: "ended" } | { type: "unavailable" };

type Dependencies = Readonly<{
  endRelationship: typeof endCompatibilityRelationshipWithReferences;
}>;

const defaultDependencies: Dependencies = {
  endRelationship: endCompatibilityRelationshipWithReferences,
};

/** 本人確認後に正本と双方の一覧参照を終了する。 */
export async function endCompatibilityRelationship(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<EndCompatibilityRelationshipOutcome> {
  if (!compatibilityRelationshipId.isValid(params.relationshipId)) return { type: "unavailable" };
  const result = await dependencies.endRelationship(
    params.accountData,
    params.compatibilityData,
    params.relationshipId,
    params.actor.accountId,
  );
  return result.outcome === "ended" || result.outcome === "unchanged"
    ? { type: "ended" }
    : { type: "unavailable" };
}
