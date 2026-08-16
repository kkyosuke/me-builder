import type { KVNamespace } from "@cloudflare/workers-types";
import * as v from "valibot";
import type {
  ApplicationSessionRecord,
  ApplicationSessionStore,
} from "../../logic/authentication/application-session";

const keyPrefix = "session:v1:";
const timestamp = v.pipe(v.string(), v.isoTimestamp());
const applicationSessionRecordSchema = v.object({
  accountId: v.pipe(v.string(), v.nonEmpty(), v.maxLength(128)),
  authenticationMethod: v.picklist(["liff", "sso"]),
  authenticatedAt: timestamp,
  issuedAt: timestamp,
  lastSeenAt: timestamp,
  expiresAt: timestamp,
  sessionVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
  csrfTokenHash: v.pipe(v.string(), v.nonEmpty(), v.maxLength(128)),
});

export class KvApplicationSessionStore implements ApplicationSessionStore {
  constructor(private readonly namespace: KVNamespace) {}

  async get(referenceHash: string): Promise<ApplicationSessionRecord | undefined> {
    const storageKey = key(referenceHash);
    const record = await this.namespace.get<unknown>(storageKey, "json");
    if (record === null) return undefined;
    const parsed = v.safeParse(applicationSessionRecordSchema, record);
    if (parsed.success) return parsed.output;
    await this.namespace.delete(storageKey);
    return undefined;
  }

  async put(
    referenceHash: string,
    record: ApplicationSessionRecord,
    ttlSeconds: number,
  ): Promise<void> {
    await this.namespace.put(key(referenceHash), JSON.stringify(record), {
      // Cloudflare KV rejects expiration TTL values below 60 seconds.
      expirationTtl: Math.max(60, Math.ceil(ttlSeconds)),
    });
  }

  async delete(referenceHash: string): Promise<void> {
    await this.namespace.delete(key(referenceHash));
  }
}

function key(referenceHash: string): string {
  return `${keyPrefix}${referenceHash}`;
}
