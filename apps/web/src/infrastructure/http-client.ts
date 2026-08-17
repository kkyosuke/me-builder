import { authSessionRuntime } from "../feature/auth/infrastructure/auth-session-runtime";

export interface HttpClient {
  request(path: string, init?: RequestInit): Promise<Response>;
}

type AuthenticatedHttpClientOptions = { authentication?: boolean };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Web標準のfetchを、APIのベースURL解決とともに提供する。 */
export function createHttpClient(
  baseUrl: string | undefined,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): HttpClient {
  const normalizedBaseUrl = (baseUrl ?? "").replace(/\/+$/, "");

  return {
    request(path, init) {
      const normalizedPath = `/${path.replace(/^\/+/, "")}`;
      return fetchImplementation(`${normalizedBaseUrl}${normalizedPath}`, init);
    },
  };
}

/** cookie、CSRF、401時のsession再確認を集約したapplication session用client。 */
export function createAuthenticatedHttpClient(
  baseUrl: string | undefined,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
  options: AuthenticatedHttpClientOptions = {},
): HttpClient {
  const client = createHttpClient(baseUrl, fetchImplementation);

  return {
    async request(path, init) {
      const authentication = options.authentication !== false;
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers);
      const csrfToken = authSessionRuntime.csrfToken();
      if (
        authentication &&
        csrfToken &&
        !SAFE_METHODS.has(method) &&
        !headers.has("X-CSRF-Token")
      ) {
        headers.set("X-CSRF-Token", csrfToken);
      }
      const response = await client.request(path, {
        ...init,
        credentials: "include",
        ...([...headers].length > 0 ? { headers } : {}),
      });
      if (authentication && response.status === 401) {
        await authSessionRuntime.recheck(init?.signal ?? new AbortController().signal);
      }
      return response;
    },
  };
}
