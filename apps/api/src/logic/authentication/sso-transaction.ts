const SSO_TRANSACTION_TTL_SECONDS = 10 * 60;
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

export type SsoAuthenticationTransaction = {
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  expiresAt: number;
};

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
  | "transaction_missing";

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
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    throw new SsoAuthenticationError("invalid_return_to");
  }

  const base = new URL("https://return-to.invalid");
  const resolved = new URL(value, base);
  if (resolved.origin !== base.origin || resolved.username || resolved.password) {
    throw new SsoAuthenticationError("invalid_return_to");
  }
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

/** state・nonce・PKCEをserver-side transactionへ保存し、Auth0の認可URLを返す。 */
export async function startSsoAuthentication(input: StartSsoAuthenticationInput): Promise<URL> {
  const now = input.now?.() ?? Date.now();
  const random = input.randomBytes ?? secureRandomBytes;
  const state = base64Url(random(RANDOM_VALUE_BYTES));
  const nonce = base64Url(random(RANDOM_VALUE_BYTES));
  const codeVerifier = base64Url(random(RANDOM_VALUE_BYTES));
  const codeChallenge = await sha256Base64Url(codeVerifier);

  await input.store.put(
    state,
    {
      nonce,
      codeVerifier,
      returnTo: normalizeSsoReturnTo(input.returnTo),
      expiresAt: now + SSO_TRANSACTION_TTL_SECONDS * 1000,
    },
    SSO_TRANSACTION_TTL_SECONDS,
  );

  return await input.client.createAuthorizationUrl({ state, nonce, codeChallenge });
}

/** callback transactionを一度だけ消費し、検証済みIdentityと復帰pathを返す。 */
export async function completeSsoAuthentication(
  input: CompleteSsoAuthenticationInput,
): Promise<{ identity: SsoVerifiedIdentity; returnTo: string }> {
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
