export const gcpPlatformEnvironments = ["development", "production"] as const;
export type GcpPlatformEnvironment = (typeof gcpPlatformEnvironments)[number];
export type GcpPlatformOperation = "preview" | "up";

export function validateGcpPlatformBackend(env: Record<string, string | undefined>): string {
  const backendUrl = env.PULUMI_BACKEND_URL?.trim();
  if (!backendUrl) throw new Error("PULUMI_BACKEND_URL is required for GCP platform state");
  if (backendUrl.startsWith("file:")) {
    throw new Error("GCP platform state must use a shared durable backend, not file://");
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//iu.test(backendUrl)) {
    throw new Error("PULUMI_BACKEND_URL must be an explicit backend URL");
  }
  if (backendUrl !== "https://api.pulumi.com" && !env.PULUMI_CONFIG_PASSPHRASE?.trim()) {
    throw new Error("A non-empty Pulumi passphrase is required for a DIY GCP platform backend");
  }
  return backendUrl;
}

export function gcpPlatformCommand(
  operation: string | undefined,
  environment: string | undefined,
  env: Record<string, string | undefined>,
): string[] {
  if (operation !== "preview" && operation !== "up") {
    throw new Error("GCP platform operation must be preview or up");
  }
  if (!gcpPlatformEnvironments.includes(environment as GcpPlatformEnvironment)) {
    throw new Error("GCP platform environment must be development or production");
  }
  const validatedEnvironment = environment as GcpPlatformEnvironment;
  validateGcpPlatformBackend(env);
  if (operation === "up" && env.ALLOW_GCP_PLATFORM_UP !== validatedEnvironment) {
    throw new Error(`Set ALLOW_GCP_PLATFORM_UP=${validatedEnvironment} to apply this Stack`);
  }
  return [
    "pulumi",
    "-C",
    "gcp-platform",
    operation,
    "--stack",
    validatedEnvironment,
    "--non-interactive",
    ...(operation === "up" ? ["--yes"] : []),
  ];
}
