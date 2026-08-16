import { describe, expect, it } from "vitest";
import {
  type AccountSessionVersionProvider,
  type ApplicationSessionRecord,
  ApplicationSessionService,
  type ApplicationSessionStore,
} from "./application-session";
import type { AuthenticatedActor } from "./types";

class MemoryStore implements ApplicationSessionStore {
  readonly records = new Map<string, ApplicationSessionRecord>();

  async get(referenceHash: string) {
    return this.records.get(referenceHash);
  }

  async put(referenceHash: string, record: ApplicationSessionRecord) {
    this.records.set(referenceHash, record);
  }

  async delete(referenceHash: string) {
    this.records.delete(referenceHash);
  }
}

class MemoryVersions implements AccountSessionVersionProvider {
  readonly versions = new Map([["account-1", 1]]);

  async current(accountId: string) {
    return this.versions.get(accountId);
  }

  async invalidate(accountId: string) {
    const current = this.versions.get(accountId);
    if (current !== undefined) this.versions.set(accountId, current + 1);
  }
}

const actor: AuthenticatedActor = {
  accountId: "account-1",
  authenticationMethod: "liff",
  authenticatedAt: new Date("2026-08-17T00:00:00.000Z"),
};

describe("ApplicationSessionService", () => {
  it("opaque tokenをhash参照だけで保存し、idle期限を更新して検証する", async () => {
    const store = new MemoryStore();
    const versions = new MemoryVersions();
    let now = new Date("2026-08-17T00:00:00.000Z");
    const sessions = new ApplicationSessionService(
      store,
      versions,
      { absoluteTtlMs: 10_000, idleTtlMs: 5_000 },
      () => now,
    );

    const issued = await sessions.issue(actor);
    expect(issued).toBeDefined();
    const reference = [...store.records.keys()][0];
    expect(reference).toMatch(/^[a-f0-9]{64}$/);
    expect(reference).not.toContain(issued?.sessionToken ?? "unreachable");

    now = new Date("2026-08-17T00:00:04.000Z");
    await expect(sessions.verify(issued?.sessionToken)).resolves.toEqual(actor);
    expect([...store.records.values()][0]?.lastSeenAt).toBe(now.toISOString());
  });

  it("absolute期限とidle期限を超えたsessionを削除する", async () => {
    const policy = { absoluteTtlMs: 10_000, idleTtlMs: 5_000 };
    let now = new Date("2026-08-17T00:00:00.000Z");
    const idleStore = new MemoryStore();
    const idleSessions = new ApplicationSessionService(
      idleStore,
      new MemoryVersions(),
      policy,
      () => now,
    );
    const idle = await idleSessions.issue(actor);
    now = new Date("2026-08-17T00:00:05.000Z");
    await expect(idleSessions.verify(idle?.sessionToken)).resolves.toBeUndefined();
    expect(idleStore.records.size).toBe(0);

    now = new Date("2026-08-17T00:00:00.000Z");
    const absoluteStore = new MemoryStore();
    const absoluteSessions = new ApplicationSessionService(
      absoluteStore,
      new MemoryVersions(),
      policy,
      () => now,
    );
    const absolute = await absoluteSessions.issue(actor);
    now = new Date("2026-08-17T00:00:04.000Z");
    await absoluteSessions.verify(absolute?.sessionToken);
    now = new Date("2026-08-17T00:00:10.000Z");
    await expect(absoluteSessions.verify(absolute?.sessionToken)).resolves.toBeUndefined();
    expect(absoluteStore.records.size).toBe(0);
  });

  it("明示的に抑止した検証ではidle期限を更新しない", async () => {
    const store = new MemoryStore();
    let now = new Date("2026-08-17T00:00:00.000Z");
    const sessions = new ApplicationSessionService(
      store,
      new MemoryVersions(),
      { absoluteTtlMs: 10_000, idleTtlMs: 5_000 },
      () => now,
    );
    const issued = await sessions.issue(actor);
    const issuedLastSeenAt = [...store.records.values()][0]?.lastSeenAt;

    now = new Date("2026-08-17T00:00:04.000Z");
    await expect(sessions.verify(issued?.sessionToken, { refreshIdle: false })).resolves.toEqual(
      actor,
    );
    expect([...store.records.values()][0]?.lastSeenAt).toBe(issuedLastSeenAt);
  });

  it("rotationとlogoutで以前の参照を再利用できない", async () => {
    const store = new MemoryStore();
    let now = new Date("2026-08-17T00:00:00.000Z");
    const sessions = new ApplicationSessionService(
      store,
      new MemoryVersions(),
      { absoluteTtlMs: 10_000, idleTtlMs: 5_000 },
      () => now,
    );
    const first = await sessions.issue(actor);
    now = new Date("2026-08-17T00:00:04.000Z");
    const rotated = await sessions.rotate(first?.sessionToken ?? "");

    expect(rotated?.sessionToken).not.toBe(first?.sessionToken);
    expect(rotated?.expiresAt).toEqual(first?.expiresAt);
    await expect(sessions.verify(first?.sessionToken)).resolves.toBeUndefined();
    await expect(sessions.verify(rotated?.sessionToken)).resolves.toEqual(actor);

    await sessions.logout(rotated?.sessionToken);
    await expect(sessions.verify(rotated?.sessionToken)).resolves.toBeUndefined();
  });

  it("KV recordが残っていても共有D1 versionの変更で即時失効する", async () => {
    const store = new MemoryStore();
    const versions = new MemoryVersions();
    const sessions = new ApplicationSessionService(store, versions);
    const issued = await sessions.issue(actor);

    await sessions.invalidateAccountSessions(actor.accountId);
    expect(store.records.size).toBe(1);
    await expect(sessions.verify(issued?.sessionToken)).resolves.toBeUndefined();
    expect(store.records.size).toBe(0);
  });

  it("停止または削除済みAccountにはsessionを発行しない", async () => {
    const versions = new MemoryVersions();
    versions.versions.delete(actor.accountId);
    const sessions = new ApplicationSessionService(new MemoryStore(), versions);

    await expect(sessions.issue(actor)).resolves.toBeUndefined();
  });
});
