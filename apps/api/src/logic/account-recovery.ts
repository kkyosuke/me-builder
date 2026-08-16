import { D1, line } from "@me-builder/lib";
import { createLiffSession } from "./liff-session";

const RECOVERY_CODE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

type SessionParams = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
};

export async function issueAccountRecoveryCode(
  params: SessionParams & { now?: Date; createSession?: typeof createLiffSession },
) {
  const session = await (params.createSession ?? createLiffSession)({
    idToken: params.idToken,
    lineLoginChannelId: params.lineLoginChannelId,
    db: params.db,
  });
  if (session.type !== "resolved") return { type: session.type } as const;
  const assignment = await new D1.shared.action.billing.D1AccountPlanAssignmentProvider(
    params.db,
  ).findCurrent(session.session.accountId, params.now);
  if (assignment.plan === "free") {
    await D1.shared.action.accountRecovery.recordAccountRecoveryAudit(params.db, {
      accountId: session.session.accountId,
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
    accountId: session.session.accountId,
    secretHash,
    expiresAt,
    now,
  });
  return { type: "issued", code, expiresAt: expiresAt.toISOString() } as const;
}

export async function recoverAccountWithCode(
  params: SessionParams & { code: string; requestKey: string; now?: Date },
) {
  if (!params.lineLoginChannelId || !params.idToken) return { type: "unauthenticated" } as const;
  const verified = await line.idToken.verify({
    idToken: params.idToken,
    channelId: params.lineLoginChannelId,
  });
  if (!verified.ok) return { type: "unauthenticated" } as const;
  const now = params.now ?? new Date();
  const identityFingerprint = await sha256Base64Url(verified.claims.sub);
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
    newProviderAccountId: verified.claims.sub,
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
  return {
    type: "recovered",
    accountId: linked?.accountId ?? credential.accountId,
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
