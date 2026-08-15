import Stripe from "stripe";
import { STRIPE_API_VERSION } from "./stripe-adapter";
import { STRIPE_BILLING_EVENT_TYPES } from "./stripe-events";

const MANAGED_BY = "me-builder-stripe-catalog";
const CATALOG_VERSION = "2026-08-15";

export type StripeCatalogEnvironment = "preview" | "production";
export type StripeCatalogPlan = "lite" | "full" | "family";
type BillingInterval = "month" | "year";

export const STRIPE_BILLING_CATALOG = [
  {
    plan: "lite",
    productId: "me_builder_lite",
    name: "me-builder Lite",
    description: "日記と週次の振り返りを無理なく続けるプラン",
    prices: [
      { interval: "month", unitAmount: 780, lookupKey: "me_builder_lite_monthly" },
      { interval: "year", unitAmount: 7_800, lookupKey: "me_builder_lite_yearly" },
    ],
  },
  {
    plan: "full",
    productId: "me_builder_full",
    name: "me-builder Full",
    description: "過去の記憶を使った助言、変化の確認、セルフケアを利用するプラン",
    prices: [
      { interval: "month", unitAmount: 1_480, lookupKey: "me_builder_full_monthly" },
      { interval: "year", unitAmount: 14_800, lookupKey: "me_builder_full_yearly" },
    ],
  },
  {
    plan: "family",
    productId: "me_builder_family",
    name: "me-builder ファミリーパック",
    description: "最大4 AccountでFull相当の機能を利用するプラン",
    prices: [
      { interval: "month", unitAmount: 2_980, lookupKey: "me_builder_family_monthly" },
      { interval: "year", unitAmount: 29_800, lookupKey: "me_builder_family_yearly" },
    ],
  },
] as const satisfies readonly {
  plan: StripeCatalogPlan;
  productId: string;
  name: string;
  description: string;
  prices: readonly {
    interval: BillingInterval;
    unitAmount: number;
    lookupKey: string;
  }[];
}[];

export interface CatalogProduct {
  id: string;
  metadata: Readonly<Record<string, string>>;
}

export interface CatalogPrice {
  id: string;
  active: boolean;
  productId: string;
  currency: string;
  unitAmount: number | null;
  interval: string | null;
  intervalCount: number | null;
  taxBehavior: string | null;
  lookupKey: string | null;
  metadata: Readonly<Record<string, string>>;
}

export interface CatalogWebhookEndpoint {
  id: string;
  url: string;
  apiVersion: string | null;
  status: string;
  metadata: Readonly<Record<string, string>>;
}

export interface CatalogPortalConfiguration {
  id: string;
  metadata: Readonly<Record<string, string>>;
}

interface ProductSpec {
  id: string;
  name: string;
  description: string;
  metadata: Record<string, string>;
}

interface PriceSpec {
  productId: string;
  unitAmount: number;
  interval: BillingInterval;
  lookupKey: string;
  transferLookupKey: boolean;
  metadata: Record<string, string>;
}

interface WebhookSpec {
  url: string;
  enabledEvents: readonly string[];
  metadata: Record<string, string>;
}

interface PortalSpec {
  webBaseUrl: string;
  metadata: Record<string, string>;
}

export interface StripeCatalogApi {
  listProducts(): Promise<readonly CatalogProduct[]>;
  createProduct(spec: ProductSpec): Promise<CatalogProduct>;
  updateProduct(id: string, spec: Omit<ProductSpec, "id">): Promise<CatalogProduct>;
  setDefaultPrice(productId: string, priceId: string): Promise<void>;
  listPricesByLookupKeys(lookupKeys: readonly string[]): Promise<readonly CatalogPrice[]>;
  listPricesByProduct(productId: string): Promise<readonly CatalogPrice[]>;
  createPrice(spec: PriceSpec): Promise<CatalogPrice>;
  setPriceActive(id: string, active: boolean): Promise<void>;
  listWebhookEndpoints(): Promise<readonly CatalogWebhookEndpoint[]>;
  createWebhookEndpoint(spec: WebhookSpec): Promise<CatalogWebhookEndpoint & { secret: string }>;
  updateWebhookEndpoint(id: string, spec: WebhookSpec): Promise<void>;
  disableWebhookEndpoint(id: string): Promise<void>;
  listPortalConfigurations(): Promise<readonly CatalogPortalConfiguration[]>;
  createPortalConfiguration(spec: PortalSpec): Promise<CatalogPortalConfiguration>;
  updatePortalConfiguration(id: string, spec: PortalSpec): Promise<void>;
}

export interface StripeBillingCatalogSetupResult {
  pricePlanMap: Readonly<Record<string, StripeCatalogPlan>>;
  webhookSecret: string | null;
  portalConfigurationId: string;
  created: readonly string[];
  updated: readonly string[];
}

const ENVIRONMENTS: Record<StripeCatalogEnvironment, { webBaseUrl: string; webhookUrl: string }> = {
  preview: {
    webBaseUrl: "https://stg.kagami.kyosuke.dev",
    webhookUrl: "https://api.stg.kagami.kyosuke.dev/api/billing/webhook",
  },
  production: {
    webBaseUrl: "https://kagami.kyosuke.dev",
    webhookUrl: "https://api.kagami.kyosuke.dev/api/billing/webhook",
  },
};

function managedMetadata(plan?: StripeCatalogPlan): Record<string, string> {
  return {
    managed_by: MANAGED_BY,
    catalog_version: CATALOG_VERSION,
    ...(plan ? { plan } : {}),
  };
}

function isManaged(metadata: Readonly<Record<string, string>>): boolean {
  return metadata.managed_by === MANAGED_BY;
}

function priceMatches(
  price: CatalogPrice,
  productId: string,
  desired: (typeof STRIPE_BILLING_CATALOG)[number]["prices"][number],
): boolean {
  return (
    price.productId === productId &&
    price.currency === "jpy" &&
    price.unitAmount === desired.unitAmount &&
    price.interval === desired.interval &&
    price.intervalCount === 1 &&
    price.taxBehavior === "inclusive"
  );
}

function assertSingle<T>(values: readonly T[], label: string): T | undefined {
  if (values.length > 1) {
    throw new Error(`Multiple Stripe resources match ${label}; resolve the duplicate before setup`);
  }
  return values[0];
}

export async function setupStripeBillingCatalog(input: {
  api: StripeCatalogApi;
  environment: StripeCatalogEnvironment;
  webhookUrl?: string;
  webBaseUrl?: string;
  rotateWebhookSecret?: boolean;
}): Promise<StripeBillingCatalogSetupResult> {
  const environment = ENVIRONMENTS[input.environment];
  const webhookUrl = input.webhookUrl ?? environment.webhookUrl;
  const webBaseUrl = input.webBaseUrl ?? environment.webBaseUrl;
  const created: string[] = [];
  const updated: string[] = [];
  const products = await input.api.listProducts();
  const productByPlan = new Map<StripeCatalogPlan, CatalogProduct>();

  for (const desired of STRIPE_BILLING_CATALOG) {
    const managed = products.filter(
      (product) => isManaged(product.metadata) && product.metadata.plan === desired.plan,
    );
    const matched = assertSingle(managed, `managed product for ${desired.plan}`);
    const occupied = products.find(
      (product) => product.id === desired.productId && !isManaged(product.metadata),
    );
    if (!matched && occupied) {
      throw new Error(
        `Stripe product ID ${desired.productId} exists but is not managed by this setup`,
      );
    }

    const spec = {
      name: desired.name,
      description: desired.description,
      metadata: managedMetadata(desired.plan),
    };
    const product = matched
      ? await input.api.updateProduct(matched.id, spec)
      : await input.api.createProduct({ id: desired.productId, ...spec });
    (matched ? updated : created).push(`product:${desired.plan}`);
    productByPlan.set(desired.plan, product);
  }

  const lookupKeys = STRIPE_BILLING_CATALOG.flatMap((product) =>
    product.prices.map((price) => price.lookupKey),
  );
  const currentPrices = await input.api.listPricesByLookupKeys(lookupKeys);
  const desiredPriceByLookupKey = new Map<string, CatalogPrice>();
  const pricePlanMap: Record<string, StripeCatalogPlan> = {};

  for (const desiredProduct of STRIPE_BILLING_CATALOG) {
    const product = productByPlan.get(desiredProduct.plan);
    if (!product) throw new Error(`Managed product is missing for ${desiredProduct.plan}`);

    for (const desiredPrice of desiredProduct.prices) {
      const matchingLookupKey = currentPrices.filter(
        (price) => price.lookupKey === desiredPrice.lookupKey,
      );
      const current = assertSingle(matchingLookupKey, `lookup key ${desiredPrice.lookupKey}`);
      if (
        current &&
        (!isManaged(current.metadata) || current.metadata.plan !== desiredProduct.plan)
      ) {
        throw new Error(
          `Stripe lookup key ${desiredPrice.lookupKey} exists but is not managed for ${desiredProduct.plan}`,
        );
      }
      let price: CatalogPrice;
      if (current && priceMatches(current, product.id, desiredPrice)) {
        price = current;
        if (!price.active) {
          await input.api.setPriceActive(price.id, true);
          updated.push(`price:${desiredPrice.lookupKey}:activated`);
        }
      } else {
        price = await input.api.createPrice({
          productId: product.id,
          unitAmount: desiredPrice.unitAmount,
          interval: desiredPrice.interval,
          lookupKey: desiredPrice.lookupKey,
          transferLookupKey: current !== undefined,
          metadata: managedMetadata(desiredProduct.plan),
        });
        created.push(`price:${desiredPrice.lookupKey}`);
        if (current?.active) {
          await input.api.setPriceActive(current.id, false);
          updated.push(`price:${current.id}:archived`);
        }
      }
      desiredPriceByLookupKey.set(desiredPrice.lookupKey, price);
      pricePlanMap[price.id] = desiredProduct.plan;
    }

    const monthly = desiredPriceByLookupKey.get(desiredProduct.prices[0].lookupKey);
    if (!monthly) throw new Error(`Monthly price is missing for ${desiredProduct.plan}`);
    await input.api.setDefaultPrice(product.id, monthly.id);
    updated.push(`product:${desiredProduct.plan}:default-price`);
  }

  for (const desired of STRIPE_BILLING_CATALOG) {
    const product = productByPlan.get(desired.plan);
    if (!product) continue;
    const prices = await input.api.listPricesByProduct(product.id);
    for (const price of prices) {
      if (isManaged(price.metadata) && price.metadata.plan === desired.plan) {
        pricePlanMap[price.id] = desired.plan;
      }
    }
  }

  const webhookMetadata = managedMetadata();
  const webhooks = await input.api.listWebhookEndpoints();
  const webhookCandidates = webhooks.filter(
    (endpoint) =>
      endpoint.status === "enabled" &&
      (isManaged(endpoint.metadata) || endpoint.url === webhookUrl),
  );
  let webhook: CatalogWebhookEndpoint | undefined;
  if (webhookCandidates.length > 1) {
    const currentVersion = webhookCandidates.filter(
      (endpoint) => isManaged(endpoint.metadata) && endpoint.apiVersion === STRIPE_API_VERSION,
    );
    webhook = assertSingle(currentVersion, `current-version webhook ${webhookUrl}`);
    if (!webhook) {
      throw new Error(
        `Multiple Stripe resources match webhook ${webhookUrl}; resolve the duplicate before setup`,
      );
    }
    for (const duplicate of webhookCandidates) {
      if (duplicate.id === webhook.id) continue;
      await input.api.disableWebhookEndpoint(duplicate.id);
      updated.push(`webhook:${duplicate.id}:duplicate-disabled`);
    }
  } else {
    webhook = webhookCandidates[0];
  }
  let webhookSecret: string | null = null;
  if (webhook?.apiVersion === STRIPE_API_VERSION && !input.rotateWebhookSecret) {
    await input.api.updateWebhookEndpoint(webhook.id, {
      url: webhookUrl,
      enabledEvents: STRIPE_BILLING_EVENT_TYPES,
      metadata: webhookMetadata,
    });
    updated.push("webhook");
  } else {
    const endpoint = await input.api.createWebhookEndpoint({
      url: webhookUrl,
      enabledEvents: STRIPE_BILLING_EVENT_TYPES,
      metadata: webhookMetadata,
    });
    webhookSecret = endpoint.secret;
    created.push(
      webhook
        ? input.rotateWebhookSecret
          ? "webhook:rotated-secret"
          : "webhook:rotated-api-version"
        : "webhook",
    );
    if (webhook) {
      await input.api.disableWebhookEndpoint(webhook.id);
      updated.push("webhook:old-disabled");
    }
  }

  const portalMetadata = managedMetadata();
  const portals = await input.api.listPortalConfigurations();
  const portal = assertSingle(
    portals.filter((configuration) => isManaged(configuration.metadata)),
    "managed Customer Portal configuration",
  );
  const portalSpec = { webBaseUrl, metadata: portalMetadata };
  let portalConfigurationId: string;
  if (portal) {
    await input.api.updatePortalConfiguration(portal.id, portalSpec);
    portalConfigurationId = portal.id;
    updated.push("customer-portal");
  } else {
    const createdPortal = await input.api.createPortalConfiguration(portalSpec);
    portalConfigurationId = createdPortal.id;
    created.push("customer-portal");
  }

  return {
    pricePlanMap: Object.fromEntries(
      Object.entries(pricePlanMap).sort(([left], [right]) => left.localeCompare(right)),
    ),
    webhookSecret,
    portalConfigurationId,
    created,
    updated,
  };
}

function productOf(price: Stripe.Price): string {
  return typeof price.product === "string" ? price.product : price.product.id;
}

function mapProduct(product: Stripe.Product): CatalogProduct {
  return { id: product.id, metadata: product.metadata };
}

function mapPrice(price: Stripe.Price): CatalogPrice {
  return {
    id: price.id,
    active: price.active,
    productId: productOf(price),
    currency: price.currency,
    unitAmount: price.unit_amount,
    interval: price.recurring?.interval ?? null,
    intervalCount: price.recurring?.interval_count ?? null,
    taxBehavior: price.tax_behavior,
    lookupKey: price.lookup_key,
    metadata: price.metadata,
  };
}

export function createStripeCatalogApi(secretKey: string): StripeCatalogApi {
  const stripe = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    timeout: 15_000,
    telemetry: false,
  });

  const all = async <T>(request: Stripe.ApiListPromise<T>): Promise<T[]> =>
    request.autoPagingToArray({ limit: 1_000 });

  const portalParams = (spec: PortalSpec): Stripe.BillingPortal.ConfigurationCreateParams => ({
    name: "me-builder billing portal",
    default_return_url: spec.webBaseUrl,
    business_profile: {
      headline: "me-builderの契約とお支払い",
      privacy_policy_url: `${spec.webBaseUrl}/privacy`,
      terms_of_service_url: `${spec.webBaseUrl}/terms`,
    },
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: {
          enabled: true,
          options: ["too_expensive", "missing_features", "unused", "other"],
        },
      },
      // Plan変更時の差額・適用時期はSUB-A-015で決定するまでPortalから変更させない。
      subscription_update: { enabled: false },
    },
    login_page: { enabled: false },
    metadata: spec.metadata,
  });

  return {
    async listProducts() {
      return (await all(stripe.products.list({ limit: 100 }))).map(mapProduct);
    },
    async createProduct(spec) {
      return mapProduct(
        await stripe.products.create({
          id: spec.id,
          name: spec.name,
          description: spec.description,
          active: true,
          type: "service",
          metadata: spec.metadata,
        }),
      );
    },
    async updateProduct(id, spec) {
      return mapProduct(
        await stripe.products.update(id, {
          name: spec.name,
          description: spec.description,
          active: true,
          metadata: spec.metadata,
        }),
      );
    },
    async setDefaultPrice(productId, priceId) {
      await stripe.products.update(productId, { default_price: priceId });
    },
    async listPricesByLookupKeys(lookupKeys) {
      return (await all(stripe.prices.list({ lookup_keys: [...lookupKeys], limit: 100 }))).map(
        mapPrice,
      );
    },
    async listPricesByProduct(productId) {
      return (await all(stripe.prices.list({ product: productId, limit: 100 }))).map(mapPrice);
    },
    async createPrice(spec) {
      return mapPrice(
        await stripe.prices.create({
          product: spec.productId,
          currency: "jpy",
          unit_amount: spec.unitAmount,
          recurring: { interval: spec.interval, interval_count: 1 },
          tax_behavior: "inclusive",
          lookup_key: spec.lookupKey,
          transfer_lookup_key: spec.transferLookupKey,
          metadata: spec.metadata,
        }),
      );
    },
    async setPriceActive(id, active) {
      await stripe.prices.update(id, { active });
    },
    async listWebhookEndpoints() {
      return (await all(stripe.webhookEndpoints.list({ limit: 100 }))).map((endpoint) => ({
        id: endpoint.id,
        url: endpoint.url,
        apiVersion: endpoint.api_version,
        status: endpoint.status,
        metadata: endpoint.metadata,
      }));
    },
    async createWebhookEndpoint(spec) {
      const endpoint = await stripe.webhookEndpoints.create({
        url: spec.url,
        api_version: STRIPE_API_VERSION,
        enabled_events: [...spec.enabledEvents],
        description: "me-builder billing projection",
        metadata: spec.metadata,
      });
      if (!endpoint.secret) throw new Error("Stripe did not return the new webhook secret");
      return {
        id: endpoint.id,
        url: endpoint.url,
        apiVersion: endpoint.api_version,
        status: endpoint.status,
        metadata: endpoint.metadata,
        secret: endpoint.secret,
      };
    },
    async updateWebhookEndpoint(id, spec) {
      await stripe.webhookEndpoints.update(id, {
        url: spec.url,
        disabled: false,
        enabled_events: [...spec.enabledEvents],
        description: "me-builder billing projection",
        metadata: spec.metadata,
      });
    },
    async disableWebhookEndpoint(id) {
      await stripe.webhookEndpoints.update(id, { disabled: true });
    },
    async listPortalConfigurations() {
      return (await all(stripe.billingPortal.configurations.list({ limit: 100 }))).map(
        (configuration) => ({
          id: configuration.id,
          metadata: configuration.metadata ?? {},
        }),
      );
    },
    async createPortalConfiguration(spec) {
      const configuration = await stripe.billingPortal.configurations.create(portalParams(spec));
      return { id: configuration.id, metadata: configuration.metadata ?? {} };
    },
    async updatePortalConfiguration(id, spec) {
      await stripe.billingPortal.configurations.update(id, {
        ...portalParams(spec),
        active: true,
      });
    },
  };
}
