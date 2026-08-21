export const pulumiGcsBackends = {
  cloudflare: "gs://kagami-infra/kagami/cloudflare",
  gcpPlatform: "gs://kagami-infra/kagami/gcp-platform",
} as const;

export function requirePulumiGcsBackend(
  env: Record<string, string | undefined>,
  expectedBackendUrl: string,
): string {
  const configuredBackendUrl = env.PULUMI_BACKEND_URL?.trim();
  if (configuredBackendUrl && configuredBackendUrl !== expectedBackendUrl) {
    throw new Error(`PULUMI_BACKEND_URL must match ${expectedBackendUrl}`);
  }

  if (!env.PULUMI_CONFIG_PASSPHRASE?.trim()) {
    throw new Error("PULUMI_CONFIG_PASSPHRASE is required for the GCS backend");
  }

  return expectedBackendUrl;
}
