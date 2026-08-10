export async function run(command: string[], options: { stdout?: "inherit" | "pipe" } = {}) {
  const process = Bun.spawn(command, {
    cwd: new URL("..", import.meta.url).pathname,
    env: processEnv(),
    stdin: "inherit",
    stdout: options.stdout ?? "inherit",
    stderr: "inherit",
  });
  const output =
    options.stdout === "pipe" ? new Response(process.stdout).text() : Promise.resolve("");
  const [exitCode, stdout] = await Promise.all([process.exited, output]);
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
  }
  return stdout;
}

export function processEnv() {
  return {
    ...process.env,
    PULUMI_CONFIG_PASSPHRASE: process.env.PULUMI_CONFIG_PASSPHRASE || "",
    PULUMI_SKIP_UPDATE_CHECK: "true",
  };
}

export function requireCloudflareEnvironment() {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");
  }
  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
  };
}

export function requirePreviewConfirmation() {
  if (process.env.ALLOW_PREVIEW_DESTROY !== "preview") {
    throw new Error('Set ALLOW_PREVIEW_DESTROY="preview" for destructive Preview operations');
  }
}
