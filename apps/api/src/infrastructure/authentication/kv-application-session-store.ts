import type { KVNamespace } from "@cloudflare/workers-types";
import type {
  ApplicationSessionRecord,
  ApplicationSessionStore,
} from "../../logic/authentication/application-session";

const keyPrefix = "session:v1:";

export class KvApplicationSessionStore implements ApplicationSessionStore {
  constructor(private readonly namespace: KVNamespace) {}

  async get(referenceHash: string): Promise<ApplicationSessionRecord | undefined> {
    const record = await this.namespace.get<ApplicationSessionRecord>(key(referenceHash), "json");
    return record ?? undefined;
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
