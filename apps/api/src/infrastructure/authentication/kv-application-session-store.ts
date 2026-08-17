import type { KVNamespace } from "@cloudflare/workers-types";
import * as v from "valibot";
import type {
  ApplicationSessionRecord,
  ApplicationSessionStore,
} from "../../logic/authentication/application-session";

// v2でauthenticatedIdentityIdを追加した。旧recordをprefixで拒否し、Identity固有操作が
// sessionを認証したprovider Identityを推測しないようにする。
const keyPrefix = "session:v2:";
const timestamp = v.pipe(v.string(), v.isoTimestamp());
const applicationSessionRecordSchema = v.object({
  accountId: v.pipe(v.string(), v.nonEmpty(), v.maxLength(128)),
  authenticationMethod: v.picklist(["liff", "sso"]),
  authenticatedAt: timestamp,
  issuedAt: timestamp,
  lastSeenAt: timestamp,
  expiresAt: timestamp,
  sessionVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
  csrfToken: v.pipe(v.string(), v.nonEmpty(), v.maxLength(128)),
  authenticatedIdentityId: v.optional(v.pipe(v.string(), v.nonEmpty(), v.maxLength(128))),
  displayProfile: v.optional(
    v.object({
      displayName: v.optional(v.pipe(v.string(), v.maxLength(256))),
      pictureUrl: v.optional(v.pipe(v.string(), v.url(), v.maxLength(2_048))),
    }),
  ),
});

export class KvApplicationSessionStore implements ApplicationSessionStore {
  constructor(private readonly namespace: KVNamespace) {}

  async get(referenceHash: string): Promise<ApplicationSessionRecord | undefined> {
    const storageKey = key(referenceHash);
    const record = await this.namespace.get<unknown>(storageKey, "json");
    if (record === null) return undefined;
    const parsed = v.safeParse(applicationSessionRecordSchema, record);
    if (parsed.success) {
      const { authenticatedIdentityId, displayProfile, ...session } = parsed.output;
      return {
        ...session,
        ...(authenticatedIdentityId ? { authenticatedIdentityId } : {}),
        ...(displayProfile
          ? {
              displayProfile: {
                ...(displayProfile.displayName !== undefined
                  ? { displayName: displayProfile.displayName }
                  : {}),
                ...(displayProfile.pictureUrl !== undefined
                  ? { pictureUrl: displayProfile.pictureUrl }
                  : {}),
              },
            }
          : {}),
      };
    }
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
