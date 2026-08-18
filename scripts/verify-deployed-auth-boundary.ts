type Environment = "preview" | "production";

type VerificationInput = Readonly<{
  environment: Environment;
  apiBaseUrl: string;
  webOrigin: string;
  liffIdTokenA?: string;
  liffIdTokenB?: string;
  confirmDisposableAccounts?: boolean;
  fetcher?: typeof fetch;
}>;

type Session = Readonly<{ cookie: string; csrfToken: string }>;

const COOKIE_NAME = "__Host-me_builder_session";
const CSRF_HEADER = "X-CSRF-Token";
const HOSTILE_ORIGIN = "https://auth-boundary.invalid";

export async function verifyDeployedAuthBoundary(
  input: VerificationInput,
): Promise<Readonly<{ environment: Environment; checks: string[]; credentials: string }>> {
  const fetcher = input.fetcher ?? fetch;
  const apiOrigin = secureOrigin(input.apiBaseUrl, "API base URL");
  const webOrigin = secureOrigin(input.webOrigin, "Web origin");
  if (apiOrigin === webOrigin) throw new Error("API and Web must use different origins");
  const checks: string[] = [];

  const health = await fetcher(new URL("/api/health", apiOrigin), {
    headers: { Origin: webOrigin },
  });
  expectStatus(health, 200, "health");
  expectAllowedCors(health, webOrigin, "health");
  const healthBody = await readRecord(health, "health");
  if (healthBody.status !== "ok" || healthBody.environment !== input.environment) {
    throw new Error("Health response does not match the requested environment");
  }
  checks.push("environment-health", "allowed-origin-cors");

  const hostileHealth = await fetcher(new URL("/api/health", apiOrigin), {
    headers: { Origin: HOSTILE_ORIGIN },
  });
  expectStatus(hostileHealth, 200, "hostile-origin health");
  expectNoCors(hostileHealth, "hostile-origin health");

  const preflight = await fetcher(new URL("/api/auth/session", apiOrigin), {
    method: "OPTIONS",
    headers: {
      Origin: webOrigin,
      "Access-Control-Request-Method": "DELETE",
      "Access-Control-Request-Headers": CSRF_HEADER,
    },
  });
  expectStatus(preflight, 204, "session preflight");
  expectAllowedCors(preflight, webOrigin, "session preflight");
  const allowedHeaders = (preflight.headers.get("Access-Control-Allow-Headers") ?? "")
    .toLowerCase()
    .split(",")
    .map((value) => value.trim());
  if (!allowedHeaders.includes(CSRF_HEADER.toLowerCase())) {
    throw new Error("Session preflight does not allow the CSRF header");
  }
  checks.push("hostile-origin-cors-denied", "csrf-preflight");

  const hostileExchange = await fetcher(new URL("/api/auth/liff/exchange", apiOrigin), {
    method: "POST",
    headers: { Origin: HOSTILE_ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: "invalid-probe-credential" }),
  });
  expectStatus(hostileExchange, 403, "hostile-origin exchange");
  expectNoCors(hostileExchange, "hostile-origin exchange");
  if (hostileExchange.headers.has("Set-Cookie")) {
    throw new Error("Hostile-origin exchange issued a cookie");
  }

  const anonymous = await sessionRequest(fetcher, apiOrigin, webOrigin);
  expectStatus(anonymous, 401, "anonymous session");
  expectAllowedCors(anonymous, webOrigin, "anonymous session");
  checks.push("hostile-origin-exchange-denied", "anonymous-session-denied");

  if (!input.liffIdTokenA) {
    if (input.liffIdTokenB) throw new Error("Token A is required when token B is provided");
    return { environment: input.environment, checks, credentials: "skipped" };
  }
  if (!input.confirmDisposableAccounts) {
    throw new Error("Credential checks require explicit disposable Accounts confirmation");
  }

  const first = await exchange(fetcher, apiOrigin, webOrigin, input.liffIdTokenA);
  const firstRead = await sessionRequest(fetcher, apiOrigin, webOrigin, first.cookie);
  expectStatus(firstRead, 200, "session reuse");
  expectAllowedCors(firstRead, webOrigin, "session reuse");
  expectNoStore(firstRead, "session reuse");
  checks.push("session-cookie-attributes", "liff-exchange", "session-reuse");

  expectStatus(
    await logoutRequest(fetcher, apiOrigin, webOrigin, first.cookie),
    403,
    "logout without CSRF",
  );
  expectStatus(
    await logoutRequest(fetcher, apiOrigin, webOrigin, first.cookie, "invalid-csrf"),
    403,
    "logout with invalid CSRF",
  );
  const hostileLogout = await logoutRequest(
    fetcher,
    apiOrigin,
    HOSTILE_ORIGIN,
    first.cookie,
    first.csrfToken,
  );
  expectStatus(hostileLogout, 403, "logout from hostile origin");
  expectNoCors(hostileLogout, "logout from hostile origin");
  expectStatus(
    await sessionRequest(fetcher, apiOrigin, webOrigin, first.cookie),
    200,
    "session after rejected logout",
  );
  checks.push("csrf-required", "csrf-origin-bound");

  const replacement = await exchange(
    fetcher,
    apiOrigin,
    webOrigin,
    input.liffIdTokenB ?? input.liffIdTokenA,
    first.cookie,
  );
  if (replacement.cookie === first.cookie) throw new Error("Exchange did not rotate the cookie");
  expectStatus(
    await sessionRequest(fetcher, apiOrigin, webOrigin, first.cookie),
    401,
    "old session after exchange",
  );
  expectStatus(
    await sessionRequest(fetcher, apiOrigin, webOrigin, replacement.cookie),
    200,
    "replacement session",
  );
  checks.push(input.liffIdTokenB ? "account-switch" : "session-rotation");

  const logout = await logoutRequest(
    fetcher,
    apiOrigin,
    webOrigin,
    replacement.cookie,
    replacement.csrfToken,
  );
  expectStatus(logout, 204, "logout");
  expectDeletionCookie(logout);
  expectStatus(
    await sessionRequest(fetcher, apiOrigin, webOrigin, replacement.cookie),
    401,
    "old session after logout",
  );
  checks.push("logout", "stale-session-denied");

  return { environment: input.environment, checks, credentials: "completed" };
}

async function exchange(
  fetcher: typeof fetch,
  apiOrigin: string,
  webOrigin: string,
  idToken: string,
  cookie?: string,
): Promise<Session> {
  const response = await fetcher(new URL("/api/auth/liff/exchange", apiOrigin), {
    method: "POST",
    headers: {
      Origin: webOrigin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ idToken }),
  });
  expectStatus(response, 200, "LIFF exchange");
  expectAllowedCors(response, webOrigin, "LIFF exchange");
  expectNoStore(response, "LIFF exchange");
  const sessionCookie = expectSessionCookie(response);
  const body = await readRecord(response, "LIFF exchange");
  if (body.authenticated !== true || typeof body.csrfToken !== "string" || !body.csrfToken) {
    throw new Error("LIFF exchange returned an invalid session state");
  }
  if (JSON.stringify(body).includes(idToken)) throw new Error("LIFF credential was reflected");
  return { cookie: sessionCookie, csrfToken: body.csrfToken };
}

function sessionRequest(
  fetcher: typeof fetch,
  apiOrigin: string,
  webOrigin: string,
  cookie?: string,
): Promise<Response> {
  return fetcher(new URL("/api/auth/session", apiOrigin), {
    headers: { Origin: webOrigin, ...(cookie ? { Cookie: cookie } : {}) },
  });
}

function logoutRequest(
  fetcher: typeof fetch,
  apiOrigin: string,
  origin: string,
  cookie: string,
  csrfToken?: string,
): Promise<Response> {
  return fetcher(new URL("/api/auth/session", apiOrigin), {
    method: "DELETE",
    headers: { Origin: origin, Cookie: cookie, ...(csrfToken ? { [CSRF_HEADER]: csrfToken } : {}) },
  });
}

function expectSessionCookie(response: Response): string {
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("Application session cookie was not issued");
  const attributes = setCookie.split(";").map((value) => value.trim());
  const cookie = attributes[0] ?? "";
  if (!cookie.startsWith(`${COOKIE_NAME}=`) || cookie === `${COOKIE_NAME}=`) {
    throw new Error("Application session cookie uses an invalid name or value");
  }
  for (const required of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) {
    if (!attributes.includes(required)) throw new Error(`Session cookie lacks ${required}`);
  }
  if (attributes.some((attribute) => attribute.toLowerCase().startsWith("domain="))) {
    throw new Error("Session cookie must be host-only");
  }
  return cookie;
}

function expectDeletionCookie(response: Response): void {
  const value = response.headers.get("Set-Cookie") ?? "";
  if (!value.startsWith(`${COOKIE_NAME}=`) || !/Max-Age=0/iu.test(value)) {
    throw new Error("Logout did not expire the session cookie");
  }
  if (/Domain=/iu.test(value)) throw new Error("Logout cookie must be host-only");
}

function expectAllowedCors(response: Response, origin: string, check: string): void {
  if (
    response.headers.get("Access-Control-Allow-Origin") !== origin ||
    response.headers.get("Access-Control-Allow-Credentials") !== "true"
  ) {
    throw new Error(`${check} did not return exact credentialed CORS`);
  }
}

function expectNoCors(response: Response, check: string): void {
  if ([...response.headers.keys()].some((name) => name.startsWith("access-control-"))) {
    throw new Error(`${check} unexpectedly returned CORS headers`);
  }
}

function expectNoStore(response: Response, check: string): void {
  if (response.headers.get("Cache-Control") !== "no-store") {
    throw new Error(`${check} did not return Cache-Control: no-store`);
  }
}

function expectStatus(response: Response, expected: number, check: string): void {
  if (response.status !== expected) {
    throw new Error(`${check} returned HTTP ${response.status}; expected ${expected}`);
  }
}

async function readRecord(response: Response, check: string): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${check} returned invalid JSON`);
  }
  return value as Record<string, unknown>;
}

function secureOrigin(value: string, label: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.origin !== url.href.replace(/\/$/u, "")
  ) {
    throw new Error(`${label} must be an HTTPS origin without path, query, or credentials`);
  }
  return url.origin;
}

function defaults(environment: Environment): Readonly<{ apiBaseUrl: string; webOrigin: string }> {
  return environment === "preview"
    ? {
        apiBaseUrl: "https://api.stg.kagami.kyosuke.dev",
        webOrigin: "https://stg.kagami.kyosuke.dev",
      }
    : {
        apiBaseUrl: "https://api.kagami.kyosuke.dev",
        webOrigin: "https://kagami.kyosuke.dev",
      };
}

function parseEnvironment(value: string | undefined): Environment {
  if (value === "preview" || value === "production") return value;
  throw new Error("Environment must be preview or production");
}

if (import.meta.main) {
  const environment = parseEnvironment(process.argv[2]);
  const deployment = defaults(environment);
  const result = await verifyDeployedAuthBoundary({
    environment,
    apiBaseUrl: process.env.AUTH_BOUNDARY_API_BASE_URL?.trim() || deployment.apiBaseUrl,
    webOrigin: process.env.AUTH_BOUNDARY_WEB_ORIGIN?.trim() || deployment.webOrigin,
    ...(process.env.AUTH_BOUNDARY_LIFF_ID_TOKEN_A?.trim()
      ? { liffIdTokenA: process.env.AUTH_BOUNDARY_LIFF_ID_TOKEN_A.trim() }
      : {}),
    ...(process.env.AUTH_BOUNDARY_LIFF_ID_TOKEN_B?.trim()
      ? { liffIdTokenB: process.env.AUTH_BOUNDARY_LIFF_ID_TOKEN_B.trim() }
      : {}),
    confirmDisposableAccounts:
      process.env.AUTH_BOUNDARY_LOGOUT_CONFIRMATION === "disposable-accounts",
  });
  console.info(JSON.stringify({ outcome: "succeeded", ...result }));
}
