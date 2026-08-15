import {
  type CompatibilityDataNamespace,
  type CompatibilityRelationship,
  compatibilityPairProgressionLevel,
  compatibilityPairProgressionMarks,
  compatibilityPairProgressionThreshold,
  createCompatibilityInvitationAcceptanceContext,
  createCompatibilityInvitationPreview,
  decideCompatibilityInvitationAcceptance,
  decideCompatibilityInvitationCancellation,
  decideCompatibilityInvitationCreation,
  decideCompatibilityRelationshipEnd,
  getAcceptedCompatibilityRelationship,
} from "@me-builder/lib";

export type CompatibilityDataTestStore = Readonly<{
  namespace: CompatibilityDataNamespace;
  relationships: ReadonlyMap<string, CompatibilityRelationship>;
}>;

/** API E2Eで、関係名ごとのCompatibilityData状態だけを再現するtest double。 */
export function createCompatibilityDataTestStore(): CompatibilityDataTestStore {
  const relationships = new Map<string, CompatibilityRelationship>();
  const progressionThemes = new Map<string, Map<string, string>>();
  const progressionGrowth = new Map<string, number>();
  const namespace: CompatibilityDataNamespace = {
    getByName(name) {
      return {
        async createInvitation(relationshipId, input) {
          if (relationshipId !== name) throw new Error("CompatibilityData test routing mismatch");
          const result = decideCompatibilityInvitationCreation(
            relationships.get(name) ?? null,
            relationshipId,
            input,
            new Date(),
          );
          relationships.set(name, result.relationship);
          return result;
        },
        async getInvitationPreview(relationshipId, viewerAccountId) {
          if (relationshipId !== name) throw new Error("CompatibilityData test routing mismatch");
          return createCompatibilityInvitationPreview(
            relationships.get(name) ?? null,
            viewerAccountId,
            new Date(),
          );
        },
        async getInvitationAcceptanceContext(relationshipId) {
          if (relationshipId !== name) throw new Error("CompatibilityData test routing mismatch");
          return createCompatibilityInvitationAcceptanceContext(
            relationships.get(name) ?? null,
            new Date(),
          );
        },
        async acceptInvitation(relationshipId, input) {
          if (relationshipId !== name) throw new Error("CompatibilityData test routing mismatch");
          const result = decideCompatibilityInvitationAcceptance(
            relationships.get(name) ?? null,
            input,
            new Date(),
          );
          if (result.outcome === "accepted") relationships.set(name, result.relationship);
          return result;
        },
        async cancelInvitation(relationshipId, actorAccountId) {
          if (relationshipId !== name) throw new Error("CompatibilityData test routing mismatch");
          const result = decideCompatibilityInvitationCancellation(
            relationships.get(name) ?? null,
            actorAccountId,
            new Date(),
          );
          if (result.outcome === "cancelled") relationships.set(name, result.relationship);
          return result;
        },
        async getRelationship(relationshipId, actorAccountId) {
          if (relationshipId !== name) throw new Error("CompatibilityData test routing mismatch");
          return getAcceptedCompatibilityRelationship(
            relationships.get(name) ?? null,
            actorAccountId,
          );
        },
        async synchronizeProgression(relationshipId, actorAccountId, themes) {
          if (relationshipId !== name) throw new Error("CompatibilityData test routing mismatch");
          if (
            !getAcceptedCompatibilityRelationship(relationships.get(name) ?? null, actorAccountId)
          ) {
            return null;
          }
          const saved = progressionThemes.get(name) ?? new Map<string, string>();
          let growthValue = progressionGrowth.get(name) ?? 0;
          const resumeBaseline = growthValue > 0 && saved.size === 0;
          for (const theme of themes) {
            const fingerprint = saved.get(theme.diagnosisId);
            growthValue +=
              fingerprint === undefined
                ? resumeBaseline
                  ? 0
                  : 3
                : fingerprint === theme.fingerprint
                  ? 0
                  : 1;
            saved.set(theme.diagnosisId, theme.fingerprint);
          }
          progressionThemes.set(name, saved);
          progressionGrowth.set(name, growthValue);
          const level = compatibilityPairProgressionLevel(growthValue);
          return {
            level,
            growthValue,
            currentLevelThreshold: compatibilityPairProgressionThreshold(level),
            nextLevelThreshold: compatibilityPairProgressionThreshold(level + 1),
            comparableThemeCount: themes.length,
            marks: compatibilityPairProgressionMarks(level),
          };
        },
        async hasProgressionState(relationshipId, actorAccountId) {
          if (relationshipId !== name) throw new Error("CompatibilityData test routing mismatch");
          return Boolean(
            getAcceptedCompatibilityRelationship(relationships.get(name) ?? null, actorAccountId) &&
              progressionGrowth.has(name),
          );
        },
        async getProgressionResumeSnapshot(relationshipId, actorAccountId) {
          if (relationshipId !== name) throw new Error("CompatibilityData test routing mismatch");
          const relationship = relationships.get(name);
          const growthValue = progressionGrowth.get(name) ?? 0;
          if (
            !relationship ||
            relationship.status !== "ended" ||
            !relationship.endedAt ||
            growthValue <= 0 ||
            (relationship.inviterAccountId !== actorAccountId &&
              relationship.inviteeAccountId !== actorAccountId)
          ) {
            return null;
          }
          return {
            relationshipCategory: relationship.relationshipCategory,
            growthValue,
            highestLevel: compatibilityPairProgressionLevel(growthValue),
            endedAt: relationship.endedAt,
          };
        },
        async restoreProgression(relationshipId, actorAccountId, snapshot) {
          if (relationshipId !== name) throw new Error("CompatibilityData test routing mismatch");
          const relationship = getAcceptedCompatibilityRelationship(
            relationships.get(name) ?? null,
            actorAccountId,
          );
          if (
            !relationship ||
            relationship.relationshipCategory !== snapshot.relationshipCategory ||
            progressionGrowth.has(name)
          ) {
            return false;
          }
          progressionGrowth.set(name, snapshot.growthValue);
          progressionThemes.set(name, new Map());
          return true;
        },
        async endRelationship(relationshipId, actorAccountId) {
          if (relationshipId !== name) throw new Error("CompatibilityData test routing mismatch");
          const result = decideCompatibilityRelationshipEnd(
            relationships.get(name) ?? null,
            actorAccountId,
            new Date(),
          );
          if (result.outcome === "ended") {
            relationships.set(name, result.relationship);
            progressionThemes.delete(name);
          }
          return result;
        },
      };
    },
  };
  return { namespace, relationships };
}
