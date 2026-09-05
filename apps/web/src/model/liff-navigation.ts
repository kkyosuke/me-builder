/** LIFF Server APIへ登録する、本人向けWebアプリの共通endpoint pathname。 */
export const LIFF_ENDPOINT_PATHNAME = "/app";

/**
 * liff.init() 後にendpointとdeep linkが結合されたpathnameを、SPAのroot基準へ戻す。
 */
export function pathnameFromLiffSecondaryRedirect(pathname: string): string | null {
  if (!pathname.startsWith(`${LIFF_ENDPOINT_PATHNAME}/`)) return null;

  const requestedPathname = pathname.slice(LIFF_ENDPOINT_PATHNAME.length);
  return requestedPathname.startsWith("//") ? null : requestedPathname;
}
