export function requirePulumiGcsBackend(env: Record<string, string | undefined>): string {
  const backendUrl = env.PULUMI_BACKEND_URL?.trim();
  if (!backendUrl) throw new Error("PULUMI_BACKEND_URL is required");
  if (!/^gs:\/\/[^/\s]+(?:\/[^\s]*)?$/u.test(backendUrl)) {
    throw new Error("PULUMI_BACKEND_URL must be a gs:// Google Cloud Storage backend URL");
  }

  if (!env.PULUMI_CONFIG_PASSPHRASE?.trim()) {
    throw new Error("PULUMI_CONFIG_PASSPHRASE is required for the GCS backend");
  }

  return backendUrl;
}
