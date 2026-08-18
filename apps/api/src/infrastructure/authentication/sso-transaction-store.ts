import type { KVNamespace } from "@cloudflare/workers-types";
import { D1 } from "@me-builder/lib";
import * as v from "valibot";
import type {
  SsoAuthenticationTransaction,
  SsoAuthenticationTransactionStore,
} from "../../logic/authentication/sso-transaction";

const TransactionEntries = {
  traceId: v.optional(v.pipe(v.string(), v.nonEmpty())),
  nonce: v.pipe(v.string(), v.nonEmpty()),
  codeVerifier: v.pipe(v.string(), v.nonEmpty()),
  returnTo: v.pipe(v.string(), v.startsWith("/")),
  expiresAt: v.pipe(v.number(), v.safeInteger()),
};

const TransactionSchema = v.variant("purpose", [
  v.object({ ...TransactionEntries, purpose: v.literal("login") }),
  v.object({
    ...TransactionEntries,
    purpose: v.literal("link"),
    initiatingAccountId: v.pipe(v.string(), v.nonEmpty()),
  }),
]);

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function transactionKey(state: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
  return base64Url(new Uint8Array(digest));
}

const MINIMUM_CLAIM_TTL_MS = 60 * 1000;

/** payloadはKV TTLで短命化し、D1の一意claimを得たcallbackだけが消費する。 */
export function createSsoTransactionStore(
  db: D1.shared.Client,
  kv: KVNamespace,
): SsoAuthenticationTransactionStore {
  return {
    async put(state, transaction, ttlSeconds) {
      await kv.put(`sso-transaction:${await transactionKey(state)}`, JSON.stringify(transaction), {
        expirationTtl: ttlSeconds,
      });
    },
    async consume(state): Promise<SsoAuthenticationTransaction | undefined> {
      const stateHash = await transactionKey(state);
      const key = `sso-transaction:${stateHash}`;
      const stored = await kv.get(key, "json");
      const parsed = v.safeParse(TransactionSchema, stored);
      if (!parsed.success) return undefined;
      const now = Date.now();
      const claimed = await D1.shared.action.ssoAuthentication.claimSsoAuthenticationTransaction(
        db,
        {
          stateHash,
          expiresAt: Math.max(parsed.output.expiresAt, now + MINIMUM_CLAIM_TTL_MS),
          removeExpiredBefore: now,
        },
      );
      if (!claimed) return undefined;
      await kv.delete(key);
      return parsed.output;
    },
  };
}
