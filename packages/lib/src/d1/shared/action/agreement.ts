import { currentServiceTerms } from "@me-builder/shared";
import { and, eq } from "drizzle-orm";
import type { SharedD1Client } from "../client";
import { accountAgreementAcceptances } from "../schema/agreement";

export async function findCurrentTermsAcceptance(db: SharedD1Client, accountId: string) {
  return await db
    .select()
    .from(accountAgreementAcceptances)
    .where(
      and(
        eq(accountAgreementAcceptances.accountId, accountId),
        eq(accountAgreementAcceptances.documentKey, currentServiceTerms.documentKey),
        eq(accountAgreementAcceptances.documentVersion, currentServiceTerms.version),
        eq(accountAgreementAcceptances.isDeleted, false),
      ),
    )
    .get();
}

export async function hasAcceptedCurrentTerms(
  db: SharedD1Client,
  accountId: string,
): Promise<boolean> {
  return (await findCurrentTermsAcceptance(db, accountId)) !== undefined;
}

/** 同じAccount・文書・versionへの再送は、最初の同意記録を返す。 */
export async function acceptCurrentTerms(
  db: SharedD1Client,
  accountId: string,
  acceptedAt = new Date(),
) {
  const existing = await findCurrentTermsAcceptance(db, accountId);
  if (existing) return existing;

  const now = new Date();
  const acceptance: typeof accountAgreementAcceptances.$inferInsert = {
    id: crypto.randomUUID(),
    accountId,
    documentKey: currentServiceTerms.documentKey,
    documentVersion: currentServiceTerms.version,
    acceptedAt: acceptedAt.toISOString(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    isDeleted: false,
  };
  await db.insert(accountAgreementAcceptances).values(acceptance).onConflictDoNothing();
  return (await findCurrentTermsAcceptance(db, accountId)) ?? acceptance;
}
