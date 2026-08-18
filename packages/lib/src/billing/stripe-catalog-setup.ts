import { publicBillingPlans } from "@me-builder/shared";
import Stripe from "stripe";
import { STRIPE_API_VERSION } from "./stripe-adapter";
import { STRIPE_BILLING_EVENT_TYPES } from "./stripe-events";

const MANAGED_BY = "me-builder-stripe-catalog";
const CATALOG_VERSION = "2026-08-18";
export const PORTAL_CONFIGURATION_VERSION = "2026-08-19-1";
export const STRIPE_BILLING_PRODUCT_TAX_CODE = "txcd_10105001";

export type StripeCatalogEnvironment = "preview" | "production";
export type StripeCatalogPlan = "lite" | "full" | "family";
type BillingInterval = "month" | "year";

export const STRIPE_BILLING_CATALOG = publicBillingPlans.map((plan) => ({
  productId: `me_builder_${plan.code}`,
  plan: plan.code,
  name: `me-builder ${plan.name}`,
  description: plan.description,
  taxCode: STRIPE_BILLING_PRODUCT_TAX_CODE,
  prices: plan.prices.map((price) => ({
    plan: plan.code,
    interval: price.interval,
    unitAmount: price.amount,
    lookupKey: price.lookupKey,
  })),
})) satisfies readonly {
  productId: string;
  plan: StripeCatalogPlan;
  name: string;
  description: string;
  taxCode: string;
  prices: readonly {
    plan: StripeCatalogPlan;
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
  active: boolean;
  isDefault: boolean;
  loginPageUrl: string | null;
  metadata: Readonly<Record<string, string>>;
}

interface ProductSpec {
  id: string;
  name: string;
  description: string;
  taxCode: string;
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

export interface PortalSpec {
  webBaseUrl: string;
  metadata: Record<string, string>;
  products: readonly { productId: string; priceIds: readonly string[] }[];
  billingCycleAnchor?: "unchanged" | "now";
  loginPageEnabled?: boolean;
  subscriptionUpdateEnabled?: boolean;
  scheduleChangesAtPeriodEnd?: boolean;
}

export interface StripeCatalogApi {
  listProducts(): Promise<readonly CatalogProduct[]>;
  createProduct(spec: ProductSpec): Promise<CatalogProduct>;
  updateProduct(id: string, spec: Omit<ProductSpec, "id">): Promise<CatalogProduct>;
  setDefaultPrice(productId: string, priceId: string): Promise<void>;
  clearDefaultPrice(productId: string): Promise<void>;
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
  updatePortalConfiguration(id: string, spec: PortalSpec): Promise<CatalogPortalConfiguration>;
  deactivatePortalConfiguration(id: string): Promise<void>;
}

export interface StripeBillingCatalogSetupResult {
  pricePlanMap: Readonly<Record<string, StripeCatalogPlan>>;
  webhookSecret: string | null;
  portalConfigurationId: string;
  portalLoginUrl: string;
  portalPlanChangeConfigurationId: string;
  portalResetConfigurationId: string;
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

function portalMetadata(mode: "management" | "standard" | "reset"): Record<string, string> {
  return {
    ...managedMetadata(),
    portal_mode: mode,
    portal_configuration_version: PORTAL_CONFIGURATION_VERSION,
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
  const desiredProductByPlan = new Map<StripeCatalogPlan, CatalogProduct>();
  for (const desiredProduct of STRIPE_BILLING_CATALOG) {
    const matchedProduct = products.find(
      (product) => product.id === desiredProduct.productId && isManaged(product.metadata),
    );
    const occupied = products.find(
      (product) => product.id === desiredProduct.productId && !isManaged(product.metadata),
    );
    if (!matchedProduct && occupied) {
      throw new Error(
        `Stripe product ID ${desiredProduct.productId} exists but is not managed by this setup`,
      );
    }
    const productSpec = {
      name: desiredProduct.name,
      description: desiredProduct.description,
      taxCode: desiredProduct.taxCode,
      metadata: managedMetadata(desiredProduct.plan),
    };
    const product = matchedProduct
      ? await input.api.updateProduct(matchedProduct.id, productSpec)
      : await input.api.createProduct({ id: desiredProduct.productId, ...productSpec });
    (matchedProduct ? updated : created).push(`product:${desiredProduct.plan}`);
    desiredProductByPlan.set(desiredProduct.plan, product);
  }

  const lookupKeys = STRIPE_BILLING_CATALOG.flatMap((product) =>
    product.prices.map((price) => price.lookupKey),
  );
  const currentPrices = await input.api.listPricesByLookupKeys(lookupKeys);
  const desiredPriceByLookupKey = new Map<string, CatalogPrice>();
  const pricePlanMap: Record<string, StripeCatalogPlan> = {};

  for (const desiredProduct of STRIPE_BILLING_CATALOG) {
    const product = desiredProductByPlan.get(desiredProduct.plan);
    if (!product) throw new Error(`Billing catalog product is missing for ${desiredProduct.plan}`);
    for (const desiredPrice of desiredProduct.prices) {
      const matchingLookupKey = currentPrices.filter(
        (price) => price.lookupKey === desiredPrice.lookupKey,
      );
      const current = assertSingle(matchingLookupKey, `lookup key ${desiredPrice.lookupKey}`);
      if (
        current &&
        (!isManaged(current.metadata) || current.metadata.plan !== desiredPrice.plan)
      ) {
        throw new Error(
          `Stripe lookup key ${desiredPrice.lookupKey} exists but is not managed for ${desiredPrice.plan}`,
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
          metadata: managedMetadata(desiredPrice.plan),
        });
        created.push(`price:${desiredPrice.lookupKey}`);
      }
      desiredPriceByLookupKey.set(desiredPrice.lookupKey, price);
      pricePlanMap[price.id] = desiredPrice.plan;
    }
  }
  for (const desiredProduct of STRIPE_BILLING_CATALOG) {
    const product = desiredProductByPlan.get(desiredProduct.plan);
    const monthlySpec = desiredProduct.prices.find((price) => price.interval === "month");
    if (!product || !monthlySpec) {
      throw new Error(`Monthly billing catalog price is missing for ${desiredProduct.plan}`);
    }
    const monthlyPrice = desiredPriceByLookupKey.get(monthlySpec.lookupKey);
    if (!monthlyPrice)
      throw new Error(`Monthly Stripe price is missing for ${desiredProduct.plan}`);
    await input.api.setDefaultPrice(product.id, monthlyPrice.id);
    updated.push(`product:${desiredProduct.plan}:default-price`);
  }

  // 旧共通Productを含む管理対象Priceも、既存契約が参照する間はPlan mapへ残す。
  const managedProducts = new Map(
    [...products, ...desiredProductByPlan.values()]
      .filter((candidate) => isManaged(candidate.metadata))
      .map((candidate) => [candidate.id, candidate]),
  );
  const desiredProductIds = new Set(
    [...desiredProductByPlan.values()].map((product) => product.id),
  );
  const desiredPriceIds = new Set([...desiredPriceByLookupKey.values()].map((price) => price.id));
  const pricesToArchive = new Map<string, CatalogPrice>();
  for (const managedProduct of managedProducts.values()) {
    for (const price of await input.api.listPricesByProduct(managedProduct.id)) {
      const plan = price.metadata.plan;
      if (isManaged(price.metadata) && (plan === "lite" || plan === "full" || plan === "family")) {
        pricePlanMap[price.id] = plan;
        if (price.active && !desiredPriceIds.has(price.id)) pricesToArchive.set(price.id, price);
      }
    }
  }
  const legacyProductIds = new Set(
    [...pricesToArchive.values()]
      .map((price) => price.productId)
      .filter((productId) => !desiredProductIds.has(productId)),
  );
  for (const productId of legacyProductIds) {
    await input.api.clearDefaultPrice(productId);
    updated.push(`product:${productId}:default-price-cleared`);
  }
  for (const price of pricesToArchive.values()) {
    await input.api.setPriceActive(price.id, false);
    updated.push(`price:${price.id}:archived`);
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

  const portals = await input.api.listPortalConfigurations();
  const portalProducts = STRIPE_BILLING_CATALOG.map((desiredProduct) => {
    const product = desiredProductByPlan.get(desiredProduct.plan);
    if (!product) throw new Error(`Managed product is missing for ${desiredProduct.plan}`);
    return {
      productId: product.id,
      priceIds: desiredProduct.prices.map((price) => {
        const current = desiredPriceByLookupKey.get(price.lookupKey);
        if (!current) throw new Error(`Managed price is missing for ${price.lookupKey}`);
        return current.id;
      }),
    };
  });
  const upsertPortal = async (mode: "management" | "standard" | "reset") => {
    const matchingMode = (configuration: CatalogPortalConfiguration) =>
      isManaged(configuration.metadata) &&
      (mode === "management"
        ? !configuration.metadata.portal_mode || configuration.metadata.portal_mode === "management"
        : configuration.metadata.portal_mode === mode);
    const modePortals = portals.filter(matchingMode);
    const portal = assertSingle(
      modePortals.filter(
        (configuration) =>
          configuration.active &&
          configuration.metadata.portal_configuration_version === PORTAL_CONFIGURATION_VERSION,
      ),
      `current Customer Portal ${mode} configuration`,
    );
    const portalSpec: PortalSpec = {
      webBaseUrl,
      metadata: portalMetadata(mode),
      products: portalProducts,
      billingCycleAnchor: mode === "reset" ? "now" : "unchanged",
      loginPageEnabled: mode === "management",
      subscriptionUpdateEnabled: mode !== "management",
      scheduleChangesAtPeriodEnd: false,
    };
    let currentPortal: CatalogPortalConfiguration;
    if (portal) {
      currentPortal = await input.api.updatePortalConfiguration(portal.id, portalSpec);
      updated.push(`customer-portal:${mode}`);
    } else {
      currentPortal = await input.api.createPortalConfiguration(portalSpec);
      created.push(`customer-portal:${mode}`);
    }
    for (const previous of modePortals) {
      if (!previous.active || previous.isDefault || previous.id === currentPortal.id) continue;
      await input.api.deactivatePortalConfiguration(previous.id);
      updated.push(`customer-portal:${mode}:previous-disabled`);
    }
    return currentPortal;
  };
  const managementPortal = await upsertPortal("management");
  const standardPortal = await upsertPortal("standard");
  const resetPortal = await upsertPortal("reset");
  if (!managementPortal.loginPageUrl) {
    throw new Error("Stripe did not return the enabled Customer Portal login page URL");
  }

  return {
    pricePlanMap: Object.fromEntries(
      Object.entries(pricePlanMap).sort(([left], [right]) => left.localeCompare(right)),
    ),
    webhookSecret,
    portalConfigurationId: managementPortal.id,
    portalLoginUrl: managementPortal.loginPageUrl,
    portalPlanChangeConfigurationId: standardPortal.id,
    portalResetConfigurationId: resetPortal.id,
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

function mapPortalConfiguration(
  configuration: Stripe.BillingPortal.Configuration,
): CatalogPortalConfiguration {
  return {
    id: configuration.id,
    active: configuration.active,
    isDefault: configuration.is_default,
    loginPageUrl: configuration.login_page.url,
    metadata: configuration.metadata ?? {},
  };
}

export const billingPortalConfigurationParams = (
  spec: PortalSpec,
): Stripe.BillingPortal.ConfigurationCreateParams => ({
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
    subscription_update:
      spec.subscriptionUpdateEnabled === false
        ? { enabled: false }
        : {
            enabled: true,
            default_allowed_updates: ["price"],
            products: spec.products.map((product) => ({
              product: product.productId,
              prices: [...product.priceIds],
            })),
            billing_cycle_anchor: spec.billingCycleAnchor ?? "unchanged",
            proration_behavior: "always_invoice",
            schedule_at_period_end: {
              conditions:
                spec.scheduleChangesAtPeriodEnd === false
                  ? []
                  : [{ type: "decreasing_item_amount" }, { type: "shortening_interval" }],
            },
            trial_update_behavior: "continue_trial",
          },
  },
  login_page: { enabled: spec.loginPageEnabled ?? false },
  metadata: spec.metadata,
});

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
          tax_code: spec.taxCode,
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
          tax_code: spec.taxCode,
          active: true,
          metadata: spec.metadata,
        }),
      );
    },
    async setDefaultPrice(productId, priceId) {
      await stripe.products.update(productId, { default_price: priceId });
    },
    async clearDefaultPrice(productId) {
      await stripe.products.update(productId, { default_price: "" });
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
        mapPortalConfiguration,
      );
    },
    async createPortalConfiguration(spec) {
      const configuration = await stripe.billingPortal.configurations.create(
        billingPortalConfigurationParams(spec),
      );
      return mapPortalConfiguration(configuration);
    },
    async updatePortalConfiguration(id, spec) {
      return mapPortalConfiguration(
        await stripe.billingPortal.configurations.update(id, {
          ...billingPortalConfigurationParams(spec),
          active: true,
        }),
      );
    },
    async deactivatePortalConfiguration(id) {
      await stripe.billingPortal.configurations.update(id, { active: false });
    },
  };
}
