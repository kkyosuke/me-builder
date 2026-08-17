import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import {
  APPLICATION_SESSION_COOKIE,
  CSRF_HEADER,
  createApplicationSessionService,
} from "../infrastructure/authentication/application-session-runtime";
import type { DisplayProfile } from "../logic/authentication/types";

const TEST_WEB_ORIGIN = "https://web.example";

type StoredValue = Readonly<{ value: string; expiresAt?: number }>;

/** API testが本番と同じcookie/CSRF境界を通るための、process内KV fixture。 */
export function createApplicationSessionFixture(database: D1Database) {
  const values = new Map<string, StoredValue>();
  const sessionStore = {
    async get(key: string, type?: string) {
      const stored = values.get(key);
      if (!stored) return null;
      if (stored.expiresAt !== undefined && stored.expiresAt <= Date.now()) {
        values.delete(key);
        return null;
      }
      return type === "json" ? JSON.parse(stored.value) : stored.value;
    },
    async put(
      key: string,
      value: string,
      options?: { expiration?: number; expirationTtl?: number },
    ) {
      const expiresAt = options?.expiration
        ? options.expiration * 1_000
        : options?.expirationTtl
          ? Date.now() + options.expirationTtl * 1_000
          : undefined;
      values.set(key, { value, ...(expiresAt === undefined ? {} : { expiresAt }) });
    },
    async delete(key: string) {
      values.delete(key);
    },
  } as unknown as KVNamespace;
  const bindings = {
    SESSION_STORE: sessionStore,
    WEB_ORIGIN: TEST_WEB_ORIGIN,
  } as const;

  return {
    bindings,
    async issue(accountId: string, displayProfile?: DisplayProfile) {
      const runtime = createApplicationSessionService({ DB: database, ...bindings });
      if (!runtime) throw new Error("Application session test runtime is unavailable");
      const identity = await runtime.db.query.accountIdentities.findFirst({
        columns: { id: true },
        where: (table, { and, eq }) =>
          and(
            eq(table.accountId, accountId),
            eq(table.provider, "line_login"),
            eq(table.isDeleted, false),
          ),
      });
      const issued = await runtime.sessions.issue(
        {
          accountId,
          authenticationMethod: "liff",
          authenticatedAt: new Date("2026-08-16T00:00:00.000Z"),
        },
        displayProfile,
        identity?.id,
      );
      if (!issued) throw new Error(`Application session could not be issued for ${accountId}`);
      return {
        headers: {
          Cookie: `${APPLICATION_SESSION_COOKIE}=${issued.sessionToken}`,
          Origin: TEST_WEB_ORIGIN,
          [CSRF_HEADER]: issued.csrfToken,
        },
        cookie: `${APPLICATION_SESSION_COOKIE}=${issued.sessionToken}`,
        csrfToken: issued.csrfToken,
      };
    },
  };
}
