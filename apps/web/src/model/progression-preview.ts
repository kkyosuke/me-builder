const UI_PREVIEW_ENVIRONMENTS = new Set(["development", "local", "preview", "test"]);

export function shouldShowProgressionPreview(
  environment: string | undefined,
  search: string,
): boolean {
  if (environment === "preview") return true;
  return (
    UI_PREVIEW_ENVIRONMENTS.has(environment ?? "") &&
    new URLSearchParams(search).get("progression-preview") === "1"
  );
}
