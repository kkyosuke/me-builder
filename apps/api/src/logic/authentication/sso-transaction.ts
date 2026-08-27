import type { ExternalSsoProvider, SsoVerifiedIdentity } from "./sso-provider";

const SSO_TRANSACTION_TTL_SECONDS = 10 * 60;
const MAX_RETURN_TO_LENGTH = 2048;
const RANDOM_VALUE_BYTES = 32;

type SsoAuthenticationTransactionBase = {
  /** OAuth stateや本人識別子とは独立した運用ログ用の相関ID。 */
  traceId?: string | undefined;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  expiresAt: number;
};

export type SsoAuthenticationTransaction = SsoAuthenticationTransactionBase &
  (
    | { purpose: "login" }
    | {
        purpose: "link";
        initiatingAccountId: string;
        handoff?: { attemptId: string; confirmationSecretHash: string } | undefined;
      }
  );

export interface SsoAuthenticationTransactionStore {
  put(state: string, transaction: SsoAuthenticationTransaction, ttlSeconds: number): Promise<void>;
  consume(state: string): Promise<SsoAuthenticationTransaction | undefined>;
}

export type SsoAuthenticationFailure =
  | "identity_unlinked"
  | "invalid_callback"
  | "invalid_return_to"
  | "transaction_expired"
  | "transaction_missing"
  | "transaction_purpose_mismatch"
  | "rollout_excluded";

export type SsoCallbackContext = {
  traceId?: string;
  returnTo: string;
  handoff?: { attemptId: string; initiatingAccountId: string };
};

export class SsoAuthenticationError extends Error {
  constructor(
    readonly reason: SsoAuthenticationFailure,
    readonly callback?: SsoCallbackContext,
  ) {
    super(`SSO authentication failed: ${reason}`);
    this.name = "SsoAuthenticationError";
  }
}

export class SsoCallbackCompletionError extends Error {
  constructor(
    readonly callback: SsoCallbackContext,
    readonly failure: unknown,
  ) {
    super("SSO callback completion failed");
    this.name = "SsoCallbackCompletionError";
  }
}

function callbackContext(transaction: SsoAuthenticationTransaction): SsoCallbackContext {
  return {
    ...(transaction.traceId ? { traceId: transaction.traceId } : {}),
    returnTo: transaction.returnTo,
    ...(transaction.purpose === "link" && transaction.handoff
      ? {
          handoff: {
            attemptId: transaction.handoff.attemptId,
            initiatingAccountId: transaction.initiatingAccountId,
          },
        }
      : {}),
  };
}

type StartSsoAuthenticationInput = {
  traceId?: string;
  returnTo: string;
  store: SsoAuthenticationTransactionStore;
  client: ExternalSsoProvider;
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
};

type SsoTransactionCompletionInput = {
  state: string;
  code: string;
  store: SsoAuthenticationTransactionStore;
  client: ExternalSsoProvider;
  now?: () => number;
};

export interface SsoExistingIdentityResolver {
  findAccount(identity: Pick<SsoVerifiedIdentity, "providerKey" | "subject">): Promise<
    | {
        accountId: string;
        authenticatedIdentityId: string;
        role: "user" | "admin";
      }
    | undefined
  >;
}

export interface SsoRolloutAuthorizer {
  allows(account: { accountId: string; role: "user" | "admin" }): Promise<boolean>;
}

export interface SsoApplicationSessionIssuer<SessionResult> {
  issue(input: {
    accountId: string;
    authenticatedIdentityId: string;
    authenticationMethod: "sso";
    authenticatedAt: Date;
  }): Promise<SessionResult>;
}

export interface SsoIdentityLinker {
  link(input: {
    accountId: string;
    providerKey: string;
    subject: string;
  }): Promise<string>;
}

export interface SsoLinkHandoffStager {
  stage(input: {
    attemptId: string;
    accountId: string;
    confirmationSecretHash: string;
    identity: SsoVerifiedIdentity;
  }): Promise<void>;
}

function secureRandomBytes(size: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(size));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

/** callback後に復元してよい同一originの相対pathだけを正規化する。 */
export function normalizeSsoReturnTo(value: string): string {
  if (
    value.length > MAX_RETURN_TO_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    throw new SsoAuthenticationError("invalid_return_to");
  }

  const base = new URL("https://return-to.invalid");
  const resolved = new URL(value, base);
  if (resolved.origin !== base.origin || resolved.username || resolved.password) {
    throw new SsoAuthenticationError("invalid_return_to");
  }
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

async function startSsoTransaction(
  input: StartSsoAuthenticationInput,
  purpose:
    | { purpose: "login" }
    | {
        purpose: "link";
        initiatingAccountId: string;
        handoff?: { attemptId: string; confirmationSecretHash: string };
      },
): Promise<URL> {
  const now = input.now?.() ?? Date.now();
  const random = input.randomBytes ?? secureRandomBytes;
  const state = `${purpose.purpose === "link" && purpose.handoff ? "liff." : ""}${base64Url(random(RANDOM_VALUE_BYTES))}`;
  const nonce = base64Url(random(RANDOM_VALUE_BYTES));
  const codeVerifier = base64Url(random(RANDOM_VALUE_BYTES));
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const authorizationUrl = await input.client.createAuthorizationUrl({
    state,
    nonce,
    codeChallenge,
  });

  await input.store.put(
    state,
    {
      ...purpose,
      ...(input.traceId ? { traceId: input.traceId } : {}),
      nonce,
      codeVerifier,
      returnTo: normalizeSsoReturnTo(input.returnTo),
      expiresAt: now + SSO_TRANSACTION_TTL_SECONDS * 1000,
    },
    SSO_TRANSACTION_TTL_SECONDS,
  );

  return authorizationUrl;
}

/** state・nonce・PKCEをlogin transactionへ保存し、Googleの認可URLを返す。 */
export async function startSsoAuthentication(input: StartSsoAuthenticationInput): Promise<URL> {
  return await startSsoTransaction(input, { purpose: "login" });
}

/** 認証済みAccountを固定したlink transactionを保存し、Googleの認可URLを返す。 */
export async function startSsoIdentityLinking(
  input: StartSsoAuthenticationInput & {
    initiatingAccountId: string;
    handoff?: { attemptId: string; confirmationSecretHash: string };
  },
): Promise<URL> {
  if (!input.initiatingAccountId) throw new SsoAuthenticationError("invalid_callback");
  return await startSsoTransaction(input, {
    purpose: "link",
    initiatingAccountId: input.initiatingAccountId,
    ...(input.handoff ? { handoff: input.handoff } : {}),
  });
}

async function consumeAndVerifySsoTransaction(
  input: SsoTransactionCompletionInput,
  expectedPurpose?: SsoAuthenticationTransaction["purpose"],
): Promise<{ identity: SsoVerifiedIdentity; transaction: SsoAuthenticationTransaction }> {
  if (!input.state || !input.code) throw new SsoAuthenticationError("invalid_callback");

  const transaction = await input.store.consume(input.state);
  if (!transaction) throw new SsoAuthenticationError("transaction_missing");
  if (transaction.expiresAt <= (input.now?.() ?? Date.now())) {
    throw new SsoAuthenticationError("transaction_expired", callbackContext(transaction));
  }
  // callback用途の取り違えでIdP側に副作用を起こす前に拒否する。
  if (expectedPurpose && transaction.purpose !== expectedPurpose) {
    throw new SsoAuthenticationError("transaction_purpose_mismatch", callbackContext(transaction));
  }

  let identity: SsoVerifiedIdentity;
  try {
    identity = await input.client.exchangeAuthorizationCode({
      code: input.code,
      codeVerifier: transaction.codeVerifier,
      expectedNonce: transaction.nonce,
      identityProvisioning: transaction.purpose === "link" ? "allow" : "existing-only",
    });
  } catch (error) {
    throw new SsoCallbackCompletionError(callbackContext(transaction), error);
  }
  return { identity, transaction };
}

/** login/link callbackを一度だけ消費し、用途に応じた副作用へ分岐する。 */
export async function completeSsoCallback<SessionResult>(
  input: SsoTransactionCompletionInput & {
    identityResolver: SsoExistingIdentityResolver;
    identityLinker: SsoIdentityLinker;
    rolloutAuthorizer: SsoRolloutAuthorizer;
    sessionIssuer: SsoApplicationSessionIssuer<SessionResult>;
    handoffStager?: SsoLinkHandoffStager;
  },
): Promise<
  | { purpose: "login"; session: SessionResult; returnTo: string; traceId?: string }
  | { purpose: "link-handoff"; attemptId: string; returnTo: string; traceId?: string }
  | {
      purpose: "link";
      accountId: string;
      authenticatedIdentityId: string;
      authenticationMethod: "sso";
      authenticatedAt: Date;
      providerKey: string;
      returnTo: string;
      traceId?: string;
    }
> {
  const { identity, transaction } = await consumeAndVerifySsoTransaction(input);
  const callback = callbackContext(transaction);
  if (transaction.purpose === "login") {
    let account:
      | { accountId: string; authenticatedIdentityId: string; role: "user" | "admin" }
      | undefined;
    try {
      account = await input.identityResolver.findAccount({
        providerKey: identity.providerKey,
        subject: identity.subject,
      });
    } catch (error) {
      throw new SsoCallbackCompletionError(callback, error);
    }
    if (!account) throw new SsoAuthenticationError("identity_unlinked", callback);
    try {
      if (
        !(await input.rolloutAuthorizer.allows({
          accountId: account.accountId,
          role: account.role,
        }))
      ) {
        throw new SsoAuthenticationError("rollout_excluded", callback);
      }
    } catch (error) {
      if (error instanceof SsoAuthenticationError) throw error;
      throw new SsoCallbackCompletionError(callback, error);
    }
    let session: SessionResult;
    try {
      session = await input.sessionIssuer.issue({
        accountId: account.accountId,
        authenticatedIdentityId: account.authenticatedIdentityId,
        authenticationMethod: identity.authenticationMethod,
        authenticatedAt: identity.authenticatedAt,
      });
    } catch (error) {
      throw new SsoCallbackCompletionError(callback, error);
    }
    return {
      purpose: "login",
      session,
      returnTo: transaction.returnTo,
      ...(transaction.traceId ? { traceId: transaction.traceId } : {}),
    };
  }

  if (transaction.handoff) {
    if (!input.handoffStager) {
      throw new SsoAuthenticationError("transaction_purpose_mismatch", callback);
    }
    try {
      await input.handoffStager.stage({
        attemptId: transaction.handoff.attemptId,
        accountId: transaction.initiatingAccountId,
        confirmationSecretHash: transaction.handoff.confirmationSecretHash,
        identity,
      });
    } catch (error) {
      throw new SsoCallbackCompletionError(callback, error);
    }
    return {
      purpose: "link-handoff",
      attemptId: transaction.handoff.attemptId,
      returnTo: transaction.returnTo,
      ...(transaction.traceId ? { traceId: transaction.traceId } : {}),
    };
  }

  let authenticatedIdentityId: string;
  try {
    authenticatedIdentityId = await input.identityLinker.link({
      accountId: transaction.initiatingAccountId,
      providerKey: identity.providerKey,
      subject: identity.subject,
    });
  } catch (error) {
    throw new SsoCallbackCompletionError(callback, error);
  }
  return {
    purpose: "link",
    accountId: transaction.initiatingAccountId,
    authenticatedIdentityId,
    authenticationMethod: identity.authenticationMethod,
    authenticatedAt: identity.authenticatedAt,
    providerKey: identity.providerKey,
    returnTo: transaction.returnTo,
    ...(transaction.traceId ? { traceId: transaction.traceId } : {}),
  };
}

/** IdPでキャンセルされたlogin/link transactionを一度だけ消費する。 */
export async function cancelSsoAuthentication(input: {
  state: string;
  store: SsoAuthenticationTransactionStore;
  now?: () => number;
}): Promise<{
  purpose: "link" | "login";
  returnTo: string;
  traceId?: string;
  handoff?: { attemptId: string; initiatingAccountId: string };
}> {
  if (!input.state) throw new SsoAuthenticationError("invalid_callback");
  const transaction = await input.store.consume(input.state);
  if (!transaction) throw new SsoAuthenticationError("transaction_missing");
  if (transaction.expiresAt <= (input.now?.() ?? Date.now())) {
    throw new SsoAuthenticationError("transaction_expired", callbackContext(transaction));
  }
  return {
    purpose: transaction.purpose,
    returnTo: transaction.returnTo,
    ...(transaction.traceId ? { traceId: transaction.traceId } : {}),
    ...(transaction.purpose === "link" && transaction.handoff
      ? {
          handoff: {
            attemptId: transaction.handoff.attemptId,
            initiatingAccountId: transaction.initiatingAccountId,
          },
        }
      : {}),
  };
}
