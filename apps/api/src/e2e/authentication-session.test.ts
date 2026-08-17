import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { D1 } from "@me-builder/lib";
import { currentServiceTerms } from "@me-builder/shared";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";

const repositoryRoot = path.resolve(__dirname, "../../../..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const webOrigin = "https://web.example";
const channelId = "1234567890";

let miniflare: Miniflare;
let database: D1Database;
let sessionStore: KVNamespace;
let lineIssuedAtSeconds: number;

async function applyMigrations(db: D1Database): Promise<void> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}

async function prepareAccounts(db: D1Database): Promise<void> {
  await applyMigrations(db);
  const timestamp = Math.floor(Date.now() / 1_000);
  await db.batch(
    [
      ["account-a", "identity-a", "line-subject-a"],
      ["account-b", "identity-b", "line-subject-b"],
    ].flatMap(([accountId, identityId, subject]) => [
      db
        .prepare(
          `INSERT INTO accounts (id, created_at, updated_at, is_deleted, status, role)
           VALUES (?, ?, ?, 0, 'active', 'user')`,
        )
        .bind(accountId, timestamp, timestamp),
      db
        .prepare(
          `INSERT INTO account_identities (
             id, created_at, updated_at, is_deleted, account_id, provider, provider_account_id
           ) VALUES (?, ?, ?, 0, ?, 'line_login', ?)`,
        )
        .bind(identityId, timestamp, timestamp, accountId, subject),
    ]),
  );
}

function mockLineVerification(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const idToken = new URLSearchParams(init?.body?.toString()).get("id_token");
      if (idToken === "invalid-credential") {
        return Response.json({ error: "invalid_request" }, { status: 400 });
      }
      const second = idToken === "credential-b";
      return Response.json({
        iss: "https://access.line.me",
        sub: second ? "line-subject-b" : "line-subject-a",
        aud: channelId,
        exp: Math.floor(Date.now() / 1_000) + 3_600,
        iat: lineIssuedAtSeconds,
        name: second ? "利用者B" : "利用者A",
        picture: second ? "https://example.com/profile-b.jpg" : "https://example.com/profile-a.jpg",
      });
    }),
  );
}

function bindings() {
  return {
    DB: database,
    SESSION_STORE: sessionStore,
    LINE_LOGIN_CHANNEL_ID: channelId,
    ENVIRONMENT: "test",
    WEB_ORIGIN: webOrigin,
  };
}

async function exchange(idToken: string, cookie?: string): Promise<Response> {
  return await app.request(
    "/api/auth/liff/exchange",
    {
      method: "POST",
      headers: {
        Origin: webOrigin,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({ idToken }),
    },
    bindings(),
  );
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("Application session cookie was not issued");
  return setCookie.split(";", 1)[0] ?? "";
}

async function getSession(cookie: string): Promise<Response> {
  return await app.request(
    "/api/auth/session",
    { headers: { Cookie: cookie, Origin: webOrigin } },
    bindings(),
  );
}

async function sessionReference(cookie: string): Promise<string> {
  const token = cookie.slice(cookie.indexOf("=") + 1);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `session:v1:${hash}`;
}

describe("application session local D1/KV E2E", () => {
  beforeEach(async () => {
    miniflare = new Miniflare({
      compatibilityDate: "2026-07-29",
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "authentication-session-e2e" },
      kvNamespaces: ["SESSION_STORE"],
    });
    database = (await miniflare.getD1Database("DB")) as D1Database;
    sessionStore = (await miniflare.getKVNamespace("SESSION_STORE")) as KVNamespace;
    await prepareAccounts(database);
    lineIssuedAtSeconds = Math.floor(Date.now() / 1_000) - 60;
    mockLineVerification();
  }, 90_000);

  afterEach(async () => {
    vi.unstubAllGlobals();
    await miniflare.dispose();
  });

  it("credential交換後はcookieだけで機能APIを利用し、CSRF検証後にlogoutする", async () => {
    const exchanged = await exchange("credential-a");
    expect(exchanged.status).toBe(200);
    expect(exchanged.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    const setCookie = exchanged.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("Domain=");
    const cookie = cookieFrom(exchanged);
    const exchangedBody = (await exchanged.json()) as {
      authenticatedAt: string;
      csrfToken: string;
      displayProfile: { displayName?: string; pictureUrl?: string };
    };
    expect(exchangedBody.authenticatedAt).toBe(new Date(lineIssuedAtSeconds * 1_000).toISOString());
    expect(exchangedBody.displayProfile).toEqual({
      displayName: "利用者A",
      pictureUrl: "https://example.com/profile-a.jpg",
    });
    expect(JSON.stringify(exchangedBody)).not.toContain("credential-a");
    expect(JSON.stringify(exchangedBody)).not.toContain("line-subject-a");

    const checked = await getSession(cookie);
    expect(checked.status).toBe(200);
    expect(await checked.json()).toMatchObject({
      authenticated: true,
      authenticatedAt: new Date(lineIssuedAtSeconds * 1_000).toISOString(),
      displayProfile: {
        displayName: "利用者A",
        pictureUrl: "https://example.com/profile-a.jpg",
      },
    });

    const feature = await app.request(
      "/api/legal/terms",
      { headers: { Cookie: cookie, Origin: webOrigin } },
      bindings(),
    );
    expect(feature.status).toBe(200);
    expect(await feature.json()).toMatchObject({ acceptance: { required: true } });

    const mutation = (origin: string, csrfToken?: string) =>
      app.request(
        "/api/legal/terms/acceptance",
        {
          method: "PUT",
          headers: {
            Cookie: cookie,
            Origin: origin,
            "Content-Type": "application/json",
            ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
          },
          body: JSON.stringify({ version: currentServiceTerms.version }),
        },
        bindings(),
      );
    expect((await mutation(webOrigin)).status).toBe(403);
    expect((await mutation("https://attacker.example", exchangedBody.csrfToken)).status).toBe(403);
    expect((await mutation(webOrigin, exchangedBody.csrfToken)).status).toBe(200);

    const logout = await app.request(
      "/api/auth/session",
      {
        method: "DELETE",
        headers: {
          Cookie: cookie,
          Origin: webOrigin,
          "X-CSRF-Token": exchangedBody.csrfToken,
        },
      },
      bindings(),
    );
    expect(logout.status).toBe(204);
    expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await getSession(cookie)).status).toBe(401);
  });

  it("IdP拒否、絶対・idle期限切れ、D1 version失効を拒否する", async () => {
    const rejected = await exchange("invalid-credential");
    expect(rejected.status).toBe(401);
    expect(rejected.headers.has("Set-Cookie")).toBe(false);

    const first = await exchange("credential-a");
    const expiredCookie = cookieFrom(first);
    const reference = await sessionReference(expiredCookie);
    const record = await sessionStore.get<Record<string, unknown>>(reference, "json");
    if (!record) throw new Error("Application session was not stored");
    await sessionStore.put(
      reference,
      JSON.stringify({ ...record, expiresAt: "2026-08-16T00:00:00.000Z" }),
    );
    expect((await getSession(expiredCookie)).status).toBe(401);

    const second = await exchange("credential-a");
    const idleExpiredCookie = cookieFrom(second);
    const idleReference = await sessionReference(idleExpiredCookie);
    const idleRecord = await sessionStore.get<Record<string, unknown>>(idleReference, "json");
    if (!idleRecord) throw new Error("Application session was not stored");
    await sessionStore.put(
      idleReference,
      JSON.stringify({
        ...idleRecord,
        lastSeenAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000).toISOString(),
      }),
    );
    expect((await getSession(idleExpiredCookie)).status).toBe(401);

    const third = await exchange("credential-a");
    const invalidatedCookie = cookieFrom(third);
    await D1.shared.action.accountSession.invalidateAccountSessions(
      D1.shared.client.create(database),
      "account-a",
    );
    expect((await getSession(invalidatedCookie)).status).toBe(401);
  });

  it("明示Bearerを古い別Account cookieより優先し、不正Bearerでもfallbackしない", async () => {
    const first = await exchange("credential-a");
    const cookie = cookieFrom(first);

    const requestWithAuthorization = (authorization: string) =>
      app.request(
        "/api/auth/session",
        {
          headers: {
            Cookie: cookie,
            Origin: webOrigin,
            Authorization: authorization,
          },
        },
        bindings(),
      );

    // session確認APIはapplication session専用なので、Account Bの有効なBearerが
    // cookieより優先されればlegacy認証として401になる。
    expect((await requestWithAuthorization("Bearer credential-b")).status).toBe(401);
    expect((await requestWithAuthorization("Bearer invalid-credential")).status).toBe(401);
    expect((await getSession(cookie)).status).toBe(200);
  });

  it("logoutは同じAccountで並行発行された全sessionを即時失効する", async () => {
    const first = await exchange("credential-a");
    const firstCookie = cookieFrom(first);
    const second = await exchange("credential-a");
    const secondCookie = cookieFrom(second);
    const secondBody = (await second.json()) as { csrfToken: string };

    expect((await getSession(firstCookie)).status).toBe(200);
    expect((await getSession(secondCookie)).status).toBe(200);

    const logout = await app.request(
      "/api/auth/session",
      {
        method: "DELETE",
        headers: {
          Cookie: secondCookie,
          Origin: webOrigin,
          "X-CSRF-Token": secondBody.csrfToken,
        },
      },
      bindings(),
    );

    expect(logout.status).toBe(204);
    expect((await getSession(firstCookie)).status).toBe(401);
    expect((await getSession(secondCookie)).status).toBe(401);
  });

  it("別AccountのLIFF credential交換時に以前のsessionを破棄する", async () => {
    const first = await exchange("credential-a");
    const firstCookie = cookieFrom(first);
    const second = await exchange("credential-b", firstCookie);
    const secondCookie = cookieFrom(second);

    expect(secondCookie).not.toBe(firstCookie);
    expect((await getSession(firstCookie)).status).toBe(401);
    const current = await getSession(secondCookie);
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({
      displayProfile: {
        displayName: "利用者B",
        pictureUrl: "https://example.com/profile-b.jpg",
      },
    });
  });
});
