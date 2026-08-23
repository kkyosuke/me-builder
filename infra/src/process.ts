export async function run(
  command: string[],
  options: { stdin?: string; stdout?: "inherit" | "pipe" } = {},
) {
  const childProcess = Bun.spawn(command, {
    cwd: new URL("..", import.meta.url).pathname,
    env: processEnv(),
    stdin: options.stdin == null ? "inherit" : "pipe",
    stdout: options.stdout ?? "inherit",
    stderr: "inherit",
  });
  if (options.stdin != null) {
    const stdin = childProcess.stdin;
    if (!stdin) throw new Error(`Failed to open stdin for command: ${command.join(" ")}`);
    stdin.write(options.stdin);
    stdin.end();
  }
  const output =
    options.stdout === "pipe" ? new Response(childProcess.stdout).text() : Promise.resolve("");
  const [exitCode, stdout] = await Promise.all([childProcess.exited, output]);
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
  }
  return stdout;
}

function processEnv() {
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
