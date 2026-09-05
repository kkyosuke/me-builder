export const DIAGNOSIS_CARD_PREVIEW_PATHNAME = "/development/diagnosis-card-preview";

const ENABLED_ENVIRONMENTS = new Set(["development", "local", "test"]);

/** DBを使わない表裏カードの表示確認画面を、開発環境の専用pathだけに公開します。 */
export function shouldShowDiagnosisCardPreview(
  environment: string | undefined,
  pathname: string,
): boolean {
  const normalizedPathname =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return (
    ENABLED_ENVIRONMENTS.has(environment ?? "") &&
    normalizedPathname === DIAGNOSIS_CARD_PREVIEW_PATHNAME
  );
}
