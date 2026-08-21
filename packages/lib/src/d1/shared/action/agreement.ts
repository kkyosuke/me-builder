import {
  currentServiceTerms,
  getEffectiveServiceTerms,
  getServiceTermsDocumentsSatisfyingCurrentRequirement,
  serviceTermsDocuments,
} from "@me-builder/shared";
import { and, desc, eq } from "drizzle-orm";
import type { SharedD1Client } from "../client";
import { accountAgreementAcceptances } from "../schema/agreement";

export async function findCurrentTermsAcceptance(
  db: SharedD1Client,
  accountId: string,
  at = new Date(),
) {
  const acceptances = await db
    .select()
    .from(accountAgreementAcceptances)
    .where(
      and(
        eq(accountAgreementAcceptances.accountId, accountId),
        eq(accountAgreementAcceptances.documentKey, currentServiceTerms.documentKey),
        eq(accountAgreementAcceptances.isDeleted, false),
      ),
    )
    .all();
  const satisfyingDocuments = getServiceTermsDocumentsSatisfyingCurrentRequirement(
    serviceTermsDocuments,
    at,
  );
  for (const document of [...satisfyingDocuments].reverse()) {
    const acceptance = acceptances.find(
      (candidate) =>
        candidate.documentVersion === document.version &&
        candidate.documentHash === document.contentHash,
    );
    if (acceptance) return acceptance;
  }
  return undefined;
}

export async function hasAcceptedCurrentTerms(
  db: SharedD1Client,
  accountId: string,
  at = new Date(),
): Promise<boolean> {
  return (await findCurrentTermsAcceptance(db, accountId, at)) !== undefined;
}

/** 本人の利用規約同意を、無効化済みを含めて新しい順に返す。 */
export async function listTermsAcceptanceHistory(db: SharedD1Client, accountId: string) {
  return await db
    .select()
    .from(accountAgreementAcceptances)
    .where(
      and(
        eq(accountAgreementAcceptances.accountId, accountId),
        eq(accountAgreementAcceptances.documentKey, currentServiceTerms.documentKey),
      ),
    )
    .orderBy(
      desc(accountAgreementAcceptances.acceptedAt),
      desc(accountAgreementAcceptances.createdAt),
    )
    .all();
}

/** 同じAccount・文書・version・本文hashへの再送は、最初の同意記録を返す。 */
export async function acceptCurrentTerms(
  db: SharedD1Client,
  accountId: string,
  acceptedAt = new Date(),
  effectiveAt = new Date(),
) {
  const currentDocument = getEffectiveServiceTerms(serviceTermsDocuments, effectiveAt);
  const existing = await findCurrentTermsAcceptance(db, accountId, effectiveAt);
  if (existing) return existing;

  const now = new Date();
  const acceptance: typeof accountAgreementAcceptances.$inferInsert = {
    id: crypto.randomUUID(),
    accountId,
    documentKey: currentDocument.documentKey,
    documentVersion: currentDocument.version,
    documentHash: currentDocument.contentHash,
    acceptedAt: acceptedAt.toISOString(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    isDeleted: false,
  };
  await db.insert(accountAgreementAcceptances).values(acceptance).onConflictDoNothing();
  const persisted = await findCurrentTermsAcceptance(db, accountId, effectiveAt);
  if (!persisted) {
    throw new Error("Failed to persist current terms acceptance");
  }
  return persisted;
}
