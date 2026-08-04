export interface HttpClient {
  request(path: string, init?: RequestInit): Promise<Response>;
}

/** Web標準のfetchを、APIのベースURL解決とともに提供する。 */
export function createHttpClient(
  baseUrl: string | undefined,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): HttpClient {
  const normalizedBaseUrl = (baseUrl ?? "").replace(/\/$/, "");

  return {
    request(path, init) {
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      return fetchImplementation(`${normalizedBaseUrl}${normalizedPath}`, init);
    },
  };
}
