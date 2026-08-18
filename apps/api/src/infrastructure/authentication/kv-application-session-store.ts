import type { KVNamespace } from "@cloudflare/workers-types";
import { OperationalError } from "@me-builder/shared";
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
  authenticatedIdentityId: v.pipe(v.string(), v.nonEmpty(), v.maxLength(128)),
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
    let record: unknown;
    try {
      record = await this.namespace.get<unknown>(storageKey, "json");
    } catch (error) {
      throw sessionStoreError(
        "SESSION_STORE_READ_FAILED",
        "authentication.session.store.read",
        error,
      );
    }
    if (record === null) return undefined;
    const parsed = v.safeParse(applicationSessionRecordSchema, record);
    if (parsed.success) {
      const { displayProfile, ...session } = parsed.output;
      return {
        ...session,
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
    await this.delete(referenceHash);
    return undefined;
  }

  async put(
    referenceHash: string,
    record: ApplicationSessionRecord,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.namespace.put(key(referenceHash), JSON.stringify(record), {
        // Cloudflare KV rejects expiration TTL values below 60 seconds.
        expirationTtl: Math.max(60, Math.ceil(ttlSeconds)),
      });
    } catch (error) {
      throw sessionStoreError(
        "SESSION_STORE_WRITE_FAILED",
        "authentication.session.store.write",
        error,
      );
    }
  }

  async delete(referenceHash: string): Promise<void> {
    try {
      await this.namespace.delete(key(referenceHash));
    } catch (error) {
      throw sessionStoreError(
        "SESSION_STORE_DELETE_FAILED",
        "authentication.session.store.delete",
        error,
      );
    }
  }
}

function sessionStoreError(code: string, stage: string, cause: unknown): OperationalError {
  return new OperationalError(
    { code, category: "dependency", stage, retryable: true, dependency: "cloudflare-kv" },
    cause,
  );
}

function key(referenceHash: string): string {
  return `${keyPrefix}${referenceHash}`;
}
