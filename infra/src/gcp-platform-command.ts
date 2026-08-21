import { requirePulumiGcsBackend } from "./pulumi-backend";

export const gcpPlatformEnvironments = ["development", "production"] as const;
export type GcpPlatformEnvironment = (typeof gcpPlatformEnvironments)[number];
export type GcpPlatformOperation = "preview" | "up";

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
  requirePulumiGcsBackend(env);
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
