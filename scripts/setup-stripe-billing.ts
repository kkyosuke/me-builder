/**
 * Stripeの商品catalog、Webhook、Customer PortalとCloudflare secretを同期します。
 *
 *   bun scripts/setup-stripe-billing.ts <preview|production> [--stripe-only]
 *
 * 必要な環境変数:
 *   - STRIPE_SECRET_KEY
 *   - CONFIRM_STRIPE_LIVE=production（productionのみ）
 * 任意:
 *   - STRIPE_WEBHOOK_SECRET（既存WebhookのsecretをCloudflareへ再投入するとき）
 *   - STRIPE_WEBHOOK_URL / WEB_BASE_URL（接続先を明示的に上書きするとき）
 */
import { billing } from "../packages/lib/src/index";

const environment = process.argv[2];
if (environment !== "preview" && environment !== "production") {
  throw new Error(
    "Usage: bun scripts/setup-stripe-billing.ts <preview|production> [--stripe-only]",
  );
}

function requireValue(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function optionalHttpsUrl(name: string, value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const url = new URL(normalized);
  if (url.protocol !== "https:") throw new Error(`${name} must use https`);
  return url.toString().replace(/\/$/, "");
}

const secretKey = requireValue("STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY);
if (environment === "preview" && !secretKey.startsWith("sk_test_")) {
  throw new Error("preview requires a Stripe test-mode secret key (sk_test_...)");
}
if (environment === "production") {
  if (!secretKey.startsWith("sk_live_")) {
    throw new Error("production requires a Stripe live-mode secret key (sk_live_...)");
  }
  if (process.env.CONFIRM_STRIPE_LIVE !== "production") {
    throw new Error("Set CONFIRM_STRIPE_LIVE=production to mutate the live Stripe account");
  }
}

async function putCloudflareSecrets(
  packageDirectory: "apps/api" | "apps/worker",
  secrets: Readonly<Record<string, string>>,
): Promise<void> {
  const child = Bun.spawn(
    ["bun", "--cwd", packageDirectory, "wrangler", "secret", "bulk", "--env", environment],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: process.env },
  );
  child.stdin.write(JSON.stringify(secrets));
  child.stdin.end();
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Failed to sync Stripe secrets into ${packageDirectory}: ${(stderr || stdout).trim()}`,
    );
  }
  console.info(`Synced ${Object.keys(secrets).join(", ")} to ${packageDirectory} (${environment})`);
}

async function listCloudflareSecretNames(
  packageDirectory: "apps/api" | "apps/worker",
): Promise<Set<string>> {
  const child = Bun.spawn(
    ["bun", "--cwd", packageDirectory, "wrangler", "secret", "list", "--env", environment],
    { stdout: "pipe", stderr: "pipe", env: process.env },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Failed to inspect Stripe secrets in ${packageDirectory}: ${(stderr || stdout).trim()}`,
    );
  }
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed))
    throw new Error(`Unexpected Wrangler secret list for ${packageDirectory}`);
  return new Set(
    parsed.flatMap((entry) =>
      entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string"
        ? [(entry as { name: string }).name]
        : [],
    ),
  );
}

const webhookUrl = optionalHttpsUrl("STRIPE_WEBHOOK_URL", process.env.STRIPE_WEBHOOK_URL);
const webBaseUrl = optionalHttpsUrl("WEB_BASE_URL", process.env.WEB_BASE_URL);
const stripeOnly = process.argv.includes("--stripe-only");
const apiSecretNames = stripeOnly ? new Set<string>() : await listCloudflareSecretNames("apps/api");
if (!stripeOnly) await listCloudflareSecretNames("apps/worker");
const suppliedWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
const result = await billing.setupStripeBillingCatalog({
  api: billing.createStripeCatalogApi(secretKey),
  environment,
  ...(webhookUrl ? { webhookUrl } : {}),
  ...(webBaseUrl ? { webBaseUrl } : {}),
  rotateWebhookSecret:
    !stripeOnly && !suppliedWebhookSecret && !apiSecretNames.has("STRIPE_WEBHOOK_SECRET"),
});

const pricePlanMap = JSON.stringify(result.pricePlanMap);
if (!stripeOnly) {
  const webhookSecret = result.webhookSecret ?? suppliedWebhookSecret;
  await putCloudflareSecrets("apps/api", {
    STRIPE_SECRET_KEY: secretKey,
    BILLING_PRICE_PLAN_MAP: pricePlanMap,
    STRIPE_PORTAL_CONFIGURATION_ID: result.portalConfigurationId,
    ...(webhookSecret ? { STRIPE_WEBHOOK_SECRET: webhookSecret } : {}),
  });
  await putCloudflareSecrets("apps/worker", {
    STRIPE_SECRET_KEY: secretKey,
    BILLING_PRICE_PLAN_MAP: pricePlanMap,
  });

  if (!webhookSecret) {
    console.warn(
      "Webhook already existed, so Stripe did not return its secret. Existing Cloudflare secret was left unchanged; set STRIPE_WEBHOOK_SECRET to replace it.",
    );
  }
}

console.info(
  JSON.stringify({
    environment,
    created: result.created,
    updated: result.updated,
    billingPricePlanMap: result.pricePlanMap,
    portalConfigurationId: result.portalConfigurationId,
    cloudflareSynced: !stripeOnly,
  }),
);
