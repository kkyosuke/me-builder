import { lte } from "drizzle-orm";
import type { SharedD1Client } from "../client";
import { ssoAuthenticationTransactionClaims } from "../schema";

/** 同じstate hashを最初にinsertできたcallbackだけがtransactionを消費できる。 */
export async function claimSsoAuthenticationTransaction(
  db: SharedD1Client,
  input: {
    stateHash: string;
    expiresAt: number;
    removeExpiredBefore: number;
  },
): Promise<boolean> {
  await db
    .delete(ssoAuthenticationTransactionClaims)
    .where(lte(ssoAuthenticationTransactionClaims.expiresAt, input.removeExpiredBefore));
  const [claimed] = await db
    .insert(ssoAuthenticationTransactionClaims)
    .values({
      stateHash: input.stateHash,
      expiresAt: input.expiresAt,
    })
    .onConflictDoNothing()
    .returning({ stateHash: ssoAuthenticationTransactionClaims.stateHash });
  return claimed !== undefined;
}
