import {
  currentServiceTerms,
  getServiceTermsDocumentsSatisfyingCurrentRequirement,
  serviceTermsDocuments,
} from "@me-builder/shared";
import { and, asc, eq, gt, isNull, min, or } from "drizzle-orm";
import type { SharedD1Client } from "../client";
import { accountIdentities, accounts } from "../schema/account";
import { accountAgreementAcceptances } from "../schema/agreement";
import { accountTermsNotifications } from "../schema/terms-notification";

export type PendingTermsLineRecipient = Readonly<{
  accountId: string;
  providerAccountId: string;
}>;

/** 現行規約へ同意済みで、対象versionのLINE告知が未完了のAccountだけを返す。 */
export async function listPendingTermsLineRecipients(
  db: SharedD1Client,
  input: Readonly<{
    documentVersion: string;
    at?: Date;
    afterAccountId?: string;
    limit?: number;
  }>,
): Promise<PendingTermsLineRecipient[]> {
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Terms notification recipient page limit must be between 1 and 100");
  }
  const satisfyingDocuments = getServiceTermsDocumentsSatisfyingCurrentRequirement(
    serviceTermsDocuments,
    input.at ?? new Date(),
  );
  const rows = await db
    .select({
      accountId: accounts.id,
      providerAccountId: min(accountIdentities.providerAccountId),
    })
    .from(accounts)
    .innerJoin(accountIdentities, eq(accountIdentities.accountId, accounts.id))
    .innerJoin(accountAgreementAcceptances, eq(accountAgreementAcceptances.accountId, accounts.id))
    .leftJoin(
      accountTermsNotifications,
      and(
        eq(accountTermsNotifications.accountId, accounts.id),
        eq(accountTermsNotifications.documentVersion, input.documentVersion),
        eq(accountTermsNotifications.channel, "line"),
      ),
    )
    .where(
      and(
        eq(accounts.status, "active"),
        eq(accounts.isDeleted, false),
        eq(accountIdentities.provider, "line"),
        eq(accountIdentities.isDeleted, false),
        eq(accountAgreementAcceptances.documentKey, currentServiceTerms.documentKey),
        eq(accountAgreementAcceptances.isDeleted, false),
        or(
          ...satisfyingDocuments.map((document) =>
            and(
              eq(accountAgreementAcceptances.documentVersion, document.version),
              eq(accountAgreementAcceptances.documentHash, document.contentHash),
            ),
          ),
        ),
        isNull(accountTermsNotifications.id),
        ...(input.afterAccountId ? [gt(accounts.id, input.afterAccountId)] : []),
      ),
    )
    .groupBy(accounts.id)
    .orderBy(asc(accounts.id))
    .limit(limit)
    .all();
  return rows.map(({ accountId, providerAccountId }) => {
    if (!providerAccountId) throw new Error("Terms notification recipient identity is missing");
    return { accountId, providerAccountId };
  });
}

export async function recordTermsLineNotification(
  db: SharedD1Client,
  input: Readonly<{
    accountId: string;
    documentVersion: string;
    disposition: "delivered" | "rejected";
    deliveredAt?: Date;
  }>,
): Promise<void> {
  const now = input.deliveredAt ?? new Date();
  await db
    .insert(accountTermsNotifications)
    .values({
      id: crypto.randomUUID(),
      accountId: input.accountId,
      documentVersion: input.documentVersion,
      channel: "line",
      disposition: input.disposition,
      deliveredAt: now.toISOString(),
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    })
    .onConflictDoNothing();
}
