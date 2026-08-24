import { and, asc, eq, inArray, max, min } from "drizzle-orm";
import { brainItemIsInference } from "../brain-item";
import type { AccountDataDatabase } from "../database";
import { brainItemEvidenceEdges, brainItems } from "../schema/brain";
import { sourceRecords } from "../schema/source";

export type PersonalDataFeatureExport = Readonly<{
  format: "kagami-brain-features";
  formatVersion: 1;
  generatedAt: string;
  scopes: readonly ["metadata", "active", "history"];
  brainItems: readonly Readonly<{
    category: string;
    status: "active" | "superseded" | "invalidated";
    derivation: "ai" | "deterministic";
    isInference: boolean;
    stability: string;
    sensitivity: string;
    validFrom: string | null;
    validTo: string | null;
    firstObservedAt: string;
    lastObservedAt: string;
    createdAt: string;
    updatedAt: string;
  }>[];
}>;

/** 本文・根拠・識別子を除いたBrain特徴だけを、API連携用に返す。 */
export async function readPersonalDataFeatureExport(
  db: AccountDataDatabase,
  accountId: string,
  at = new Date(),
): Promise<PersonalDataFeatureExport> {
  const rows = await db
    .select({
      id: brainItems.id,
      category: brainItems.category,
      attributes: brainItems.attributes,
      status: brainItems.status,
      derivation: brainItems.derivation,
      stability: brainItems.stability,
      sensitivity: brainItems.sensitivity,
      validFrom: brainItems.validFrom,
      validTo: brainItems.validTo,
      createdAt: brainItems.createdAt,
      updatedAt: brainItems.updatedAt,
    })
    .from(brainItems)
    .where(and(eq(brainItems.accountId, accountId), eq(brainItems.isDeleted, false)))
    .orderBy(asc(brainItems.createdAt), asc(brainItems.id))
    .all();
  const observationRows =
    rows.length === 0
      ? []
      : await db
          .select({
            brainItemId: brainItemEvidenceEdges.brainItemId,
            firstObservedAt: min(sourceRecords.createdAt),
            lastObservedAt: max(sourceRecords.createdAt),
          })
          .from(brainItemEvidenceEdges)
          .innerJoin(sourceRecords, eq(sourceRecords.id, brainItemEvidenceEdges.sourceRecordId))
          .where(
            and(
              inArray(
                brainItemEvidenceEdges.brainItemId,
                rows.map(({ id }) => id),
              ),
              eq(sourceRecords.accountId, accountId),
            ),
          )
          .groupBy(brainItemEvidenceEdges.brainItemId)
          .all();
  const observationsByItemId = new Map(
    observationRows.map((row) => [row.brainItemId, row] as const),
  );
  return {
    format: "kagami-brain-features",
    formatVersion: 1,
    generatedAt: at.toISOString(),
    scopes: ["metadata", "active", "history"],
    brainItems: rows.map(({ id, attributes, ...row }) => {
      const observations = observationsByItemId.get(id);
      return {
        ...row,
        isInference: brainItemIsInference(attributes, row.derivation),
        validFrom: row.validFrom?.toISOString() ?? null,
        validTo: row.validTo?.toISOString() ?? null,
        firstObservedAt: (observations?.firstObservedAt ?? row.createdAt).toISOString(),
        lastObservedAt: (observations?.lastObservedAt ?? row.createdAt).toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    }),
  };
}
