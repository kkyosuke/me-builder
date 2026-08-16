const SSO_TRANSACTION_TTL_SECONDS = 10 * 60;
const MAX_RETURN_TO_LENGTH = 2048;
const RANDOM_VALUE_BYTES = 32;

export type SsoVerifiedIdentity = {
  providerKey: "auth0";
  subject: string;
  authenticationMethod: "sso";
  authenticatedAt: Date;
  displayProfile?: {
    displayName?: string;
    pictureUrl?: string;
  };
};

type SsoAuthenticationTransactionBase = {
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
      }
  );

export interface SsoAuthenticationTransactionStore {
  put(state: string, transaction: SsoAuthenticationTransaction, ttlSeconds: number): Promise<void>;
  consume(state: string): Promise<SsoAuthenticationTransaction | undefined>;
}

export interface SsoServerClient {
  createAuthorizationUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }): Promise<URL>;
  exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    expectedNonce: string;
  }): Promise<SsoVerifiedIdentity>;
}

export type SsoAuthenticationFailure =
  | "identity_unlinked"
  | "invalid_callback"
  | "invalid_return_to"
  | "transaction_expired"
  | "transaction_missing"
  | "transaction_purpose_mismatch";

export class SsoAuthenticationError extends Error {
  constructor(readonly reason: SsoAuthenticationFailure) {
    super(`SSO authentication failed: ${reason}`);
    this.name = "SsoAuthenticationError";
  }
}

type StartSsoAuthenticationInput = {
  returnTo: string;
  store: SsoAuthenticationTransactionStore;
  client: SsoServerClient;
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
};

type CompleteSsoAuthenticationInput = {
  state: string;
  code: string;
  store: SsoAuthenticationTransactionStore;
  client: SsoServerClient;
  now?: () => number;
};

export interface SsoExistingIdentityResolver {
  findAccountId(
    identity: Pick<SsoVerifiedIdentity, "providerKey" | "subject">,
  ): Promise<string | undefined>;
}

export interface SsoApplicationSessionIssuer<SessionResult> {
  issue(input: {
    accountId: string;
    authenticationMethod: "sso";
    authenticatedAt: Date;
  }): Promise<SessionResult>;
}

export interface SsoIdentityLinker {
  link(input: {
    accountId: string;
    providerKey: "auth0";
    subject: string;
  }): Promise<string>;
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
  purpose: { purpose: "login" } | { purpose: "link"; initiatingAccountId: string },
): Promise<URL> {
  const now = input.now?.() ?? Date.now();
  const random = input.randomBytes ?? secureRandomBytes;
  const state = base64Url(random(RANDOM_VALUE_BYTES));
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
      nonce,
      codeVerifier,
      returnTo: normalizeSsoReturnTo(input.returnTo),
      expiresAt: now + SSO_TRANSACTION_TTL_SECONDS * 1000,
    },
    SSO_TRANSACTION_TTL_SECONDS,
  );

  return authorizationUrl;
}

/** state・nonce・PKCEをlogin transactionへ保存し、Auth0の認可URLを返す。 */
export async function startSsoAuthentication(input: StartSsoAuthenticationInput): Promise<URL> {
  return await startSsoTransaction(input, { purpose: "login" });
}

/** 認証済みAccountを固定したlink transactionを保存し、Auth0の認可URLを返す。 */
export async function startSsoIdentityLinking(
  input: StartSsoAuthenticationInput & { initiatingAccountId: string },
): Promise<URL> {
  if (!input.initiatingAccountId) throw new SsoAuthenticationError("invalid_callback");
  return await startSsoTransaction(input, {
    purpose: "link",
    initiatingAccountId: input.initiatingAccountId,
  });
}

async function consumeAndVerifySsoTransaction(
  input: CompleteSsoAuthenticationInput,
): Promise<{ identity: SsoVerifiedIdentity; transaction: SsoAuthenticationTransaction }> {
  if (!input.state || !input.code) throw new SsoAuthenticationError("invalid_callback");

  const transaction = await input.store.consume(input.state);
  if (!transaction) throw new SsoAuthenticationError("transaction_missing");
  if (transaction.expiresAt <= (input.now?.() ?? Date.now())) {
    throw new SsoAuthenticationError("transaction_expired");
  }

  const identity = await input.client.exchangeAuthorizationCode({
    code: input.code,
    codeVerifier: transaction.codeVerifier,
    expectedNonce: transaction.nonce,
  });
  return { identity, transaction };
}

/** login callback transactionだけを一度消費し、検証済みIdentityと復帰pathを返す。 */
export async function completeSsoAuthentication(
  input: CompleteSsoAuthenticationInput,
): Promise<{ identity: SsoVerifiedIdentity; returnTo: string }> {
  const { identity, transaction } = await consumeAndVerifySsoTransaction(input);
  if (transaction.purpose !== "login") {
    throw new SsoAuthenticationError("transaction_purpose_mismatch");
  }
  return { identity, returnTo: transaction.returnTo };
}

/** link済みIdentityだけをAccountへ解決し、共通application sessionを発行する。 */
export async function completeSsoLogin<SessionResult>(
  input: CompleteSsoAuthenticationInput & {
    identityResolver: SsoExistingIdentityResolver;
    sessionIssuer: SsoApplicationSessionIssuer<SessionResult>;
  },
): Promise<{ session: SessionResult; returnTo: string }> {
  const { identity, returnTo } = await completeSsoAuthentication(input);
  const accountId = await input.identityResolver.findAccountId({
    providerKey: identity.providerKey,
    subject: identity.subject,
  });
  if (!accountId) throw new SsoAuthenticationError("identity_unlinked");

  const session = await input.sessionIssuer.issue({
    accountId,
    authenticationMethod: identity.authenticationMethod,
    authenticatedAt: identity.authenticatedAt,
  });
  return { session, returnTo };
}

/** 開始時のAccountへだけ検証済みAuth0 Identityを追加する。 */
export async function completeSsoIdentityLinking(
  input: CompleteSsoAuthenticationInput & { identityLinker: SsoIdentityLinker },
): Promise<{
  accountId: string;
  authenticatedIdentityId: string;
  authenticationMethod: "sso";
  authenticatedAt: Date;
  providerKey: "auth0";
  returnTo: string;
}> {
  const { identity, transaction } = await consumeAndVerifySsoTransaction(input);
  if (transaction.purpose !== "link") {
    throw new SsoAuthenticationError("transaction_purpose_mismatch");
  }
  const authenticatedIdentityId = await input.identityLinker.link({
    accountId: transaction.initiatingAccountId,
    providerKey: identity.providerKey,
    subject: identity.subject,
  });
  return {
    accountId: transaction.initiatingAccountId,
    authenticatedIdentityId,
    authenticationMethod: identity.authenticationMethod,
    authenticatedAt: identity.authenticatedAt,
    providerKey: identity.providerKey,
    returnTo: transaction.returnTo,
  };
}

/** IdPでキャンセルされたlogin/link transactionを一度だけ消費する。 */
export async function cancelSsoAuthentication(input: {
  state: string;
  store: SsoAuthenticationTransactionStore;
  now?: () => number;
}): Promise<{ purpose: "link" | "login"; returnTo: string }> {
  if (!input.state) throw new SsoAuthenticationError("invalid_callback");
  const transaction = await input.store.consume(input.state);
  if (!transaction) throw new SsoAuthenticationError("transaction_missing");
  if (transaction.expiresAt <= (input.now?.() ?? Date.now())) {
    throw new SsoAuthenticationError("transaction_expired");
  }
  return { purpose: transaction.purpose, returnTo: transaction.returnTo };
}
