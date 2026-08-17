import type { KVNamespace } from "@cloudflare/workers-types";
import * as v from "valibot";
import type {
  SsoAuthenticationTransaction,
  SsoAuthenticationTransactionStore,
} from "../../logic/authentication/sso-transaction";

const TransactionEntries = {
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
  return `sso-transaction:${base64Url(new Uint8Array(digest))}`;
}

/** callback URLのstateをKV keyへ直接残さず、短命transactionを保存する。 */
export function createSsoTransactionStore(kv: KVNamespace): SsoAuthenticationTransactionStore {
  return {
    async put(state, transaction, ttlSeconds) {
      await kv.put(await transactionKey(state), JSON.stringify(transaction), {
        expirationTtl: ttlSeconds,
      });
    },
    async consume(state): Promise<SsoAuthenticationTransaction | undefined> {
      const key = await transactionKey(state);
      const stored = await kv.get(key, "json");
      await kv.delete(key);
      const parsed = v.safeParse(TransactionSchema, stored);
      return parsed.success ? parsed.output : undefined;
    },
  };
}
