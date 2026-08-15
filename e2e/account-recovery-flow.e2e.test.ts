import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../apps/api/src";
import { createLocalD1 } from "../apps/api/src/testing/local-d1";
import { D1 } from "../packages/lib/src";

const repositoryRoot = path.resolve(__dirname, "..");
const migrationsDirectory = path.join(repositoryRoot, "packages/lib/drizzle");
const channelId = "1234567890";
type LocalD1 = Awaited<ReturnType<typeof createLocalD1>>;
let localD1: LocalD1;
let database: LocalD1["database"];

async function applyMigrations() {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  for (const file of files) {
    const contents = await readFile(path.join(migrationsDirectory, file), "utf8");
    for (const statement of contents
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await database.prepare(statement).run();
    }
  }
}

describe("paid Account recovery E2E", () => {
  beforeAll(async () => {
    localD1 = await createLocalD1("paid-account-recovery-e2e");
    database = localD1.database;
    await applyMigrations();
  }, 90_000);

  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => localD1.dispose());

  it("LINE Account喪失後も同じAccount IDとPlan紐付けへ再接続し、再送と誤接続を防ぐ", async () => {
    const db = D1.shared.client.create(database);
    const old = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-old",
    });
    await D1.shared.action.agreement.acceptCurrentTerms(db, old.account.id);
    await D1.shared.action.billing.linkBillingCustomer(db, {
      accountId: old.account.id,
      providerCustomerId: "cus_recovery_e2e",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const idToken = new URLSearchParams(String(init?.body)).get("id_token");
        const sub =
          idToken === "old-token"
            ? "line-old"
            : idToken === "new-token"
              ? "line-new"
              : "line-conflict";
        return Response.json({
          iss: "https://access.line.me",
          sub,
          aud: channelId,
          exp: 4_000_000_000,
        });
      }),
    );
    const bindings = { DB: database, LINE_LOGIN_CHANNEL_ID: channelId, ENVIRONMENT: "test" };

    const issue = await app.request(
      "/api/account-recovery/codes",
      { method: "POST", headers: { Authorization: "Bearer old-token" } },
      bindings,
    );
    expect(issue.status).toBe(201);
    const { code } = (await issue.json()) as { code: string };

    const recover = await app.request(
      "/api/account-recovery/complete",
      {
        method: "POST",
        headers: { Authorization: "Bearer new-token", "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      },
      bindings,
    );
    expect(recover.status).toBe(200);
    expect(await recover.json()).toEqual({ status: "recovered", alreadyRecovered: false });

    const identities = await db.query.accountIdentities.findMany({
      where: (table, { eq }) => eq(table.accountId, old.account.id),
    });
    expect(identities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerAccountId: "line-old", isDeleted: true }),
        expect.objectContaining({ providerAccountId: "line-new", isDeleted: false }),
      ]),
    );
    await expect(
      D1.shared.action.billing.findBillingCustomerByAccount(db, old.account.id),
    ).resolves.toMatchObject({
      accountId: old.account.id,
      providerCustomerId: "cus_recovery_e2e",
    });

    const retry = await app.request(
      "/api/account-recovery/complete",
      {
        method: "POST",
        headers: { Authorization: "Bearer new-token", "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      },
      bindings,
    );
    expect(await retry.json()).toEqual({ status: "recovered", alreadyRecovered: true });

    const other = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-conflict",
    });
    expect(other.account.id).not.toBe(old.account.id);
    const secondIssue = await app.request(
      "/api/account-recovery/codes",
      { method: "POST", headers: { Authorization: "Bearer new-token" } },
      bindings,
    );
    const secondCode = ((await secondIssue.json()) as { code: string }).code;
    const conflict = await app.request(
      "/api/account-recovery/complete",
      {
        method: "POST",
        headers: { Authorization: "Bearer conflict-token", "Content-Type": "application/json" },
        body: JSON.stringify({ code: secondCode }),
      },
      bindings,
    );
    expect(conflict.status).toBe(409);
    expect(
      await db.query.accountIdentities.findMany({
        where: (table, { eq }) => eq(table.accountId, old.account.id),
      }),
    ).toHaveLength(2);
  });
});
