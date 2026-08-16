import { D1 } from "@me-builder/lib";
import type { AuthenticatedActor } from "./authentication/types";

const RECOVERY_CODE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

type BaseParams = {
  db: D1.shared.Client;
};

export type VerifiedRecoveryIdentity = Readonly<{
  subject: string;
}>;

export interface AccountSessionInvalidator {
  invalidateAccountSessions(accountId: string): Promise<void>;
}

const pendingSessionInvalidator: AccountSessionInvalidator = {
  async invalidateAccountSessions() {},
};

export async function issueAccountRecoveryCode(
  params: BaseParams & { actor: AuthenticatedActor; now?: Date },
) {
  const assignment = await new D1.shared.action.billing.D1AccountPlanAssignmentProvider(
    params.db,
  ).findCurrent(params.actor.accountId, params.now);
  if (assignment.plan === "free") {
    await D1.shared.action.accountRecovery.recordAccountRecoveryAudit(params.db, {
      accountId: params.actor.accountId,
      action: "issue",
      outcome: "rejected",
      reason: "paid-contract-required",
      ...(params.now ? { now: params.now } : {}),
    });
    return { type: "paid-contract-required" } as const;
  }

  const id = crypto.randomUUID();
  const secret = randomBase64Url(32);
  const code = `${id}.${secret}`;
  const secretHash = await saltedHash(secret);
  const now = params.now ?? new Date();
  const expiresAt = new Date(now.getTime() + RECOVERY_CODE_TTL_MS);
  await D1.shared.action.accountRecovery.issueAccountRecoveryCredential(params.db, {
    id,
    accountId: params.actor.accountId,
    secretHash,
    expiresAt,
    now,
  });
  return { type: "issued", code, expiresAt: expiresAt.toISOString() } as const;
}

export async function recoverAccountWithCode(
  params: BaseParams & {
    identity: VerifiedRecoveryIdentity;
    sourceAccountId: string;
    code: string;
    requestKey: string;
    now?: Date;
  },
  sessionInvalidator: AccountSessionInvalidator = pendingSessionInvalidator,
) {
  const now = params.now ?? new Date();
  const identityFingerprint = await sha256Base64Url(params.identity.subject);
  const rateLimitKeys = [
    await sha256Base64Url(`identity:${identityFingerprint}`),
    await sha256Base64Url(`request:${params.requestKey}`),
  ];
  if (
    await D1.shared.action.accountRecovery.isAccountRecoveryRateLimited(
      params.db,
      rateLimitKeys,
      now,
    )
  ) {
    await D1.shared.action.accountRecovery.recordAccountRecoveryAudit(params.db, {
      accountId: null,
      action: "complete",
      outcome: "rejected",
      reason: "rate-limited",
      identityFingerprint,
      now,
    });
    return { type: "rate-limited" } as const;
  }
  const [credentialId, secret, ...rest] = params.code.trim().split(".");
  if (!credentialId || !secret || rest.length > 0) {
    await rejectRecoveryAttempt(params.db, rateLimitKeys, identityFingerprint, null, now);
    return { type: "invalid-code" } as const;
  }
  const credential = await D1.shared.action.accountRecovery.findAccountRecoveryCredential(
    params.db,
    credentialId,
  );
  if (!credential || !(await matchesSaltedHash(secret, credential.secretHash))) {
    await rejectRecoveryAttempt(
      params.db,
      rateLimitKeys,
      identityFingerprint,
      credential?.accountId ?? null,
      now,
    );
    return { type: "invalid-code" } as const;
  }
  const result = await D1.shared.action.accountRecovery.completeAccountRecovery(params.db, {
    credentialId,
    expectedSecretHash: credential.secretHash,
    newProviderAccountId: params.identity.subject,
    sourceAccountId: params.sourceAccountId,
    identityFingerprint,
    now,
  });
  if (result === "conflict" || result === "invalid") {
    await rejectRecoveryAttempt(
      params.db,
      rateLimitKeys,
      identityFingerprint,
      credential.accountId,
      now,
      result === "conflict" ? "identity-conflict" : "invalid-code",
    );
    return result === "conflict"
      ? ({ type: "identity-conflict" } as const)
      : ({ type: "invalid-code" } as const);
  }
  await D1.shared.action.accountRecovery.clearAccountRecoveryFailures(params.db, rateLimitKeys);
  const linked = await D1.shared.action.accountRecovery.findAccountRecoveryCredential(
    params.db,
    credentialId,
  );
  const accountId = linked?.accountId ?? credential.accountId;
  // 冪等な再送より後に発行されたsessionまで失効させない。
  // Identityを実際に再接続した初回だけ、復旧先と移管元の旧sessionを失効する。
  if (result === "recovered") {
    await sessionInvalidator.invalidateAccountSessions(accountId);
    if (params.sourceAccountId !== accountId) {
      await sessionInvalidator.invalidateAccountSessions(params.sourceAccountId);
    }
  }
  return {
    type: "recovered",
    accountId,
    alreadyRecovered: result === "already-recovered",
  } as const;
}

async function rejectRecoveryAttempt(
  db: D1.shared.Client,
  rateLimitKeys: readonly string[],
  identityFingerprint: string,
  accountId: string | null,
  now: Date,
  reason = "invalid-code",
): Promise<void> {
  await D1.shared.action.accountRecovery.recordAccountRecoveryFailure(db, rateLimitKeys, now);
  await D1.shared.action.accountRecovery.recordAccountRecoveryAudit(db, {
    accountId,
    action: "complete",
    outcome: "rejected",
    reason,
    identityFingerprint,
    now,
  });
}

function randomBase64Url(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return bytesToBase64Url(bytes);
}

async function saltedHash(secret: string): Promise<string> {
  const salt = randomBase64Url(16);
  return `v1.${salt}.${await sha256Base64Url(`${salt}:${secret}`)}`;
}

async function matchesSaltedHash(secret: string, encoded: string): Promise<boolean> {
  const [version, salt, digest, ...rest] = encoded.split(".");
  if (version !== "v1" || !salt || !digest || rest.length > 0) return false;
  const candidate = await sha256Base64Url(`${salt}:${secret}`);
  if (candidate.length !== digest.length) return false;
  let difference = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    difference |= candidate.charCodeAt(index) ^ digest.charCodeAt(index);
  }
  return difference === 0;
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
