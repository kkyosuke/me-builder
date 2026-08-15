import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { STRIPE_API_VERSION } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import Stripe from "stripe";
import * as v from "valibot";

const PlanSchema = v.picklist(["lite", "full", "family"]);
const CatalogSchema = v.object({
  currency: v.pipe(v.string(), v.regex(/^[a-z]{3}$/)),
  products: v.pipe(
    v.array(
      v.object({
        key: PlanSchema,
        name: v.pipe(v.string(), v.nonEmpty()),
        prices: v.pipe(
          v.array(
            v.object({
              interval: v.picklist(["month", "year"]),
              unitAmount: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
              lookupKey: v.pipe(v.string(), v.regex(/^[a-z0-9_]+$/), v.maxLength(96)),
            }),
          ),
          v.length(2),
        ),
      }),
    ),
    v.length(3),
  ),
  webhookEvents: v.pipe(v.array(v.pipe(v.string(), v.nonEmpty())), v.minLength(1)),
});

export type BillingCatalog = v.InferOutput<typeof CatalogSchema>;

export function parseBillingCatalog(value: unknown): BillingCatalog {
  const catalog = v.parse(CatalogSchema, value);
  const productKeys = new Set(catalog.products.map((product) => product.key));
  const lookupKeys = catalog.products.flatMap((product) =>
    product.prices.map((price) => price.lookupKey),
  );
  if (
    productKeys.size !== catalog.products.length ||
    new Set(lookupKeys).size !== lookupKeys.length
  ) {
    throw new Error("Billing catalog contains duplicate keys");
  }
  for (const product of catalog.products) {
    if (new Set(product.prices.map((price) => price.interval)).size !== 2) {
      throw new Error(`Billing catalog must contain monthly and yearly prices: ${product.key}`);
    }
  }
  return catalog;
}

type Target = "local" | "preview" | "production";

export async function setupBilling(input: {
  stripe: Stripe;
  target: Target;
  catalog: BillingCatalog;
  webhookUrl: string;
  portalReturnUrl: string;
}): Promise<{
  pricePlanMap: Record<string, "lite" | "full" | "family">;
  lookupKeyMap: Record<string, string>;
  portalConfigurationId: string;
  webhookSecret?: string;
}> {
  const pricePlanMap: Record<string, "lite" | "full" | "family"> = {};
  const lookupKeyMap: Record<string, string> = {};
  const productIds: string[] = [];
  const priceIdsByProduct = new Map<string, string[]>();

  for (const declared of input.catalog.products) {
    const products = await input.stripe.products.search({
      query: `metadata['me_builder_catalog_key']:'${declared.key}'`,
      limit: 2,
    });
    if (products.data.length > 1) throw new Error(`Duplicate Stripe products: ${declared.key}`);
    const product = products.data[0]
      ? await input.stripe.products.update(products.data[0].id, {
          active: true,
          name: declared.name,
          metadata: { me_builder_catalog_key: declared.key, managed_by: "me-builder" },
        })
      : await input.stripe.products.create(
          {
            name: declared.name,
            metadata: { me_builder_catalog_key: declared.key, managed_by: "me-builder" },
          },
          { idempotencyKey: `billing-catalog-product-${declared.key}` },
        );
    productIds.push(product.id);
    const priceIds: string[] = [];
    for (const declaredPrice of declared.prices) {
      lookupKeyMap[`${declared.key}.${declaredPrice.interval}`] = declaredPrice.lookupKey;
      const prices = await input.stripe.prices.list({
        lookup_keys: [declaredPrice.lookupKey],
        active: true,
        limit: 2,
      });
      if (prices.data.length > 1)
        throw new Error(`Duplicate Stripe prices: ${declaredPrice.lookupKey}`);
      const current = prices.data[0];
      const matches =
        current?.product === product.id &&
        current.currency === input.catalog.currency &&
        current.unit_amount === declaredPrice.unitAmount &&
        current.recurring?.interval === declaredPrice.interval;
      const price = matches
        ? current
        : await input.stripe.prices.create(
            {
              product: product.id,
              currency: input.catalog.currency,
              unit_amount: declaredPrice.unitAmount,
              recurring: { interval: declaredPrice.interval },
              tax_behavior: "inclusive",
              lookup_key: declaredPrice.lookupKey,
              transfer_lookup_key: true,
              metadata: { managed_by: "me-builder", plan: declared.key },
            },
            {
              idempotencyKey: [
                "billing-catalog-price",
                declaredPrice.lookupKey,
                product.id,
                input.catalog.currency,
                declaredPrice.interval,
                declaredPrice.unitAmount,
              ].join("-"),
            },
          );
      pricePlanMap[price.id] = declared.key;
      priceIds.push(price.id);
    }
    priceIdsByProduct.set(product.id, priceIds);
  }

  const configurations = await input.stripe.billingPortal.configurations.list({ limit: 100 });
  const configuration = configurations.data.find(
    (item) =>
      item.metadata.managed_by === "me-builder" && item.metadata.environment === input.target,
  );
  const features = {
    customer_update: { enabled: false },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: "at_period_end" as const },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ["price" as const],
      proration_behavior: "none" as const,
      products: productIds.map((product) => ({
        product,
        prices: priceIdsByProduct.get(product) ?? [],
      })),
    },
  };
  const portalInput = {
    features,
    business_profile: { headline: "me-builder の契約とお支払いを管理します" },
    default_return_url: input.portalReturnUrl,
  };
  const portalConfiguration = configuration
    ? await input.stripe.billingPortal.configurations.update(configuration.id, {
        active: true,
        ...portalInput,
      })
    : await input.stripe.billingPortal.configurations.create({
        ...portalInput,
        metadata: { managed_by: "me-builder", environment: input.target },
      });

  const endpoints = await input.stripe.webhookEndpoints.list({ limit: 100 });
  const endpoint = endpoints.data.find((item) => item.url === input.webhookUrl);
  let webhookSecret: string | undefined;
  if (endpoint) {
    await input.stripe.webhookEndpoints.update(endpoint.id, {
      enabled_events: input.catalog
        .webhookEvents as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
      metadata: { managed_by: "me-builder", environment: input.target },
    });
  } else {
    const created = await input.stripe.webhookEndpoints.create({
      url: input.webhookUrl,
      enabled_events: input.catalog
        .webhookEvents as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
      metadata: { managed_by: "me-builder", environment: input.target },
    });
    webhookSecret = created.secret;
  }
  logger.info(
    { target: input.target, products: productIds.length, prices: Object.keys(pricePlanMap).length },
    "Stripe billing catalog configured",
  );
  return {
    pricePlanMap,
    lookupKeyMap,
    portalConfigurationId: portalConfiguration.id,
    webhookSecret,
  };
}

if (import.meta.main) {
  const target = process.argv[2] as Target | undefined;
  if (!target || !["local", "preview", "production"].includes(target)) {
    throw new Error("Usage: bun scripts/setup-billing.ts <local|preview|production>");
  }
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const baseUrl = process.env.BASE_URL?.trim().replace(/\/$/, "");
  const webOrigin = process.env.WEB_ORIGIN?.trim().replace(/\/$/, "");
  if (!secretKey || !baseUrl || !webOrigin) {
    throw new Error("STRIPE_SECRET_KEY, BASE_URL and WEB_ORIGIN are required");
  }
  const allowedKeyPrefixes =
    target === "production" ? ["sk_live_", "rk_live_"] : ["sk_test_", "rk_test_"];
  if (!allowedKeyPrefixes.some((prefix) => secretKey.startsWith(prefix))) {
    throw new Error(`Stripe key mode does not match target: ${target}`);
  }
  const catalogPath = resolve(
    process.env.BILLING_CATALOG_FILE ??
      new URL("../config/billing-catalog.json", import.meta.url).pathname,
  );
  const outputPath = process.env.BILLING_SETUP_OUTPUT?.trim();
  if (!outputPath) throw new Error("BILLING_SETUP_OUTPUT is required (write-only secret output)");
  const result = await setupBilling({
    stripe: new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
      telemetry: false,
    }),
    target,
    catalog: parseBillingCatalog(await Bun.file(catalogPath).json()),
    webhookUrl: `${baseUrl}/api/billing/webhook`,
    portalReturnUrl: `${webOrigin}/profile`,
  });
  const output = await open(outputPath, "w", 0o600);
  try {
    await output.chmod(0o600);
    await output.writeFile(
      `${JSON.stringify({
        BILLING_PRICE_PLAN_MAP: JSON.stringify(result.pricePlanMap),
        BILLING_LOOKUP_KEY_MAP: JSON.stringify(result.lookupKeyMap),
        BILLING_PORTAL_CONFIGURATION_ID: result.portalConfigurationId,
        ...(result.webhookSecret ? { STRIPE_WEBHOOK_SECRET: result.webhookSecret } : {}),
      })}\n`,
    );
  } finally {
    await output.close();
  }
  logger.info({ target, outputPath }, "Stripe billing setup completed; secrets were not printed");
}
