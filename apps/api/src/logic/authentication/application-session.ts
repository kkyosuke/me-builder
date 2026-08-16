import type { AuthenticatedActor } from "./types";

export type ApplicationSessionRecord = Readonly<{
  accountId: string;
  authenticationMethod: AuthenticatedActor["authenticationMethod"];
  authenticatedAt: string;
  issuedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  sessionVersion: number;
  csrfTokenHash: string;
}>;

export interface ApplicationSessionStore {
  get(referenceHash: string): Promise<ApplicationSessionRecord | undefined>;
  put(referenceHash: string, record: ApplicationSessionRecord, ttlSeconds: number): Promise<void>;
  delete(referenceHash: string): Promise<void>;
}

export interface AccountSessionVersionProvider {
  current(accountId: string): Promise<number | undefined>;
  invalidate(accountId: string): Promise<void>;
}

export type IssuedApplicationSession = Readonly<{
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
}>;

type SessionPolicy = Readonly<{ absoluteTtlMs: number; idleTtlMs: number }>;
type VerifyOptions = Readonly<{ refreshIdle?: boolean }>;
const defaultPolicy: SessionPolicy = {
  absoluteTtlMs: 30 * 24 * 60 * 60 * 1_000,
  idleTtlMs: 7 * 24 * 60 * 60 * 1_000,
};

export class ApplicationSessionService {
  constructor(
    private readonly store: ApplicationSessionStore,
    private readonly versions: AccountSessionVersionProvider,
    private readonly policy: SessionPolicy = defaultPolicy,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(actor: AuthenticatedActor): Promise<IssuedApplicationSession | undefined> {
    const sessionVersion = await this.versions.current(actor.accountId);
    if (sessionVersion === undefined) return undefined;
    const now = this.now();
    return await this.persist(
      actor,
      sessionVersion,
      new Date(now.getTime() + this.policy.absoluteTtlMs),
    );
  }

  private async persist(
    actor: AuthenticatedActor,
    sessionVersion: number,
    expiresAt: Date,
  ): Promise<IssuedApplicationSession | undefined> {
    const now = this.now();
    if (expiresAt.getTime() <= now.getTime()) return undefined;
    const sessionToken = randomToken();
    const csrfToken = randomToken();
    await this.store.put(
      await hash(sessionToken),
      {
        accountId: actor.accountId,
        authenticationMethod: actor.authenticationMethod,
        authenticatedAt: actor.authenticatedAt.toISOString(),
        issuedAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        sessionVersion,
        csrfTokenHash: await hash(csrfToken),
      },
      Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000),
    );
    return { sessionToken, csrfToken, expiresAt };
  }

  async verify(
    sessionToken: string | undefined,
    { refreshIdle = true }: VerifyOptions = {},
  ): Promise<AuthenticatedActor | undefined> {
    if (!sessionToken) return undefined;
    const referenceHash = await hash(sessionToken);
    const record = await this.store.get(referenceHash);
    if (!record) return undefined;
    const now = this.now();
    const invalid =
      Date.parse(record.expiresAt) <= now.getTime() ||
      Date.parse(record.lastSeenAt) + this.policy.idleTtlMs <= now.getTime() ||
      (await this.versions.current(record.accountId)) !== record.sessionVersion;
    if (invalid) {
      await this.store.delete(referenceHash);
      return undefined;
    }
    if (refreshIdle) {
      const ttl = Math.max(1, Math.ceil((Date.parse(record.expiresAt) - now.getTime()) / 1_000));
      await this.store.put(referenceHash, { ...record, lastSeenAt: now.toISOString() }, ttl);
    }
    return {
      accountId: record.accountId,
      authenticationMethod: record.authenticationMethod,
      authenticatedAt: new Date(record.authenticatedAt),
    };
  }

  async rotate(sessionToken: string): Promise<IssuedApplicationSession | undefined> {
    const referenceHash = await hash(sessionToken);
    const record = await this.store.get(referenceHash);
    const actor = await this.verify(sessionToken);
    if (!record || !actor) return undefined;
    await this.store.delete(referenceHash);
    return await this.persist(actor, record.sessionVersion, new Date(record.expiresAt));
  }

  async logout(sessionToken: string | undefined): Promise<void> {
    if (sessionToken) await this.store.delete(await hash(sessionToken));
  }

  async invalidateAccountSessions(accountId: string): Promise<void> {
    await this.versions.invalidate(accountId);
  }
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
