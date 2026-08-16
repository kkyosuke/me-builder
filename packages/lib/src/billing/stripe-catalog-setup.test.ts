import { describe, expect, it } from "vitest";
import {
  type CatalogPortalConfiguration,
  type CatalogPrice,
  type CatalogProduct,
  type CatalogWebhookEndpoint,
  STRIPE_BILLING_CATALOG,
  type StripeCatalogApi,
  setupStripeBillingCatalog,
} from "./stripe-catalog-setup";
import { STRIPE_BILLING_EVENT_TYPES } from "./stripe-events";

class FakeStripeCatalogApi implements StripeCatalogApi {
  products: CatalogProduct[] = [];
  prices: CatalogPrice[] = [];
  webhooks: CatalogWebhookEndpoint[] = [];
  portals: CatalogPortalConfiguration[] = [];
  createdPriceSpecs: Array<Parameters<StripeCatalogApi["createPrice"]>[0]> = [];
  archivedPriceIds: string[] = [];
  webhookEvents: readonly string[] = [];
  defaultPrices = new Map<string, string>();

  async listProducts() {
    return this.products;
  }

  async createProduct(spec: Parameters<StripeCatalogApi["createProduct"]>[0]) {
    const product = { id: spec.id, metadata: spec.metadata };
    this.products.push(product);
    return product;
  }

  async updateProduct(id: string, spec: Parameters<StripeCatalogApi["updateProduct"]>[1]) {
    const product = { id, metadata: spec.metadata };
    this.products = this.products.map((current) => (current.id === id ? product : current));
    return product;
  }

  async setDefaultPrice(productId: string, priceId: string) {
    this.defaultPrices.set(productId, priceId);
  }

  async listPricesByLookupKeys(lookupKeys: readonly string[]) {
    return this.prices.filter(
      (price) => price.lookupKey !== null && lookupKeys.includes(price.lookupKey),
    );
  }

  async listPricesByProduct(productId: string) {
    return this.prices.filter((price) => price.productId === productId);
  }

  async createPrice(spec: Parameters<StripeCatalogApi["createPrice"]>[0]) {
    this.createdPriceSpecs.push(spec);
    if (spec.transferLookupKey) {
      this.prices = this.prices.map((price) =>
        price.lookupKey === spec.lookupKey ? { ...price, lookupKey: null } : price,
      );
    }
    const price: CatalogPrice = {
      id: `price_${this.prices.length + 1}`,
      active: true,
      productId: spec.productId,
      currency: "jpy",
      unitAmount: spec.unitAmount,
      interval: spec.interval,
      intervalCount: 1,
      taxBehavior: "inclusive",
      lookupKey: spec.lookupKey,
      metadata: spec.metadata,
    };
    this.prices.push(price);
    return price;
  }

  async setPriceActive(id: string, active: boolean) {
    this.prices = this.prices.map((price) => (price.id === id ? { ...price, active } : price));
    if (!active) this.archivedPriceIds.push(id);
  }

  async listWebhookEndpoints() {
    return this.webhooks;
  }

  async createWebhookEndpoint(spec: Parameters<StripeCatalogApi["createWebhookEndpoint"]>[0]) {
    this.webhookEvents = spec.enabledEvents;
    const endpoint = {
      id: `we_${this.webhooks.length + 1}`,
      url: spec.url,
      apiVersion: "2026-07-29.dahlia",
      status: "enabled",
      metadata: spec.metadata,
      secret: "whsec_fixture",
    };
    this.webhooks.push(endpoint);
    return endpoint;
  }

  async updateWebhookEndpoint(
    id: string,
    spec: Parameters<StripeCatalogApi["updateWebhookEndpoint"]>[1],
  ) {
    this.webhookEvents = spec.enabledEvents;
    this.webhooks = this.webhooks.map((endpoint) =>
      endpoint.id === id ? { ...endpoint, id, url: spec.url, metadata: spec.metadata } : endpoint,
    );
  }

  async disableWebhookEndpoint(id: string) {
    this.webhooks = this.webhooks.map((endpoint) =>
      endpoint.id === id ? { ...endpoint, status: "disabled" } : endpoint,
    );
  }

  async listPortalConfigurations() {
    return this.portals;
  }

  async createPortalConfiguration(
    spec: Parameters<StripeCatalogApi["createPortalConfiguration"]>[0],
  ) {
    const portal = { id: "bpc_1", metadata: spec.metadata };
    this.portals.push(portal);
    return portal;
  }

  async updatePortalConfiguration(
    id: string,
    spec: Parameters<StripeCatalogApi["updatePortalConfiguration"]>[1],
  ) {
    this.portals = this.portals.map((portal) =>
      portal.id === id ? { id, metadata: spec.metadata } : portal,
    );
  }
}

describe("setupStripeBillingCatalog", () => {
  it("空のStripe環境へ商品、月額・年額Price、Webhook、Portalを再現する", async () => {
    const api = new FakeStripeCatalogApi();

    const result = await setupStripeBillingCatalog({ api, environment: "preview" });

    expect(api.products).toHaveLength(3);
    expect(api.prices).toHaveLength(6);
    expect(
      api.createdPriceSpecs.map(({ lookupKey, unitAmount, interval }) => ({
        lookupKey,
        unitAmount,
        interval,
      })),
    ).toEqual([
      { lookupKey: "me_builder_lite_monthly", unitAmount: 780, interval: "month" },
      { lookupKey: "me_builder_lite_yearly", unitAmount: 7_800, interval: "year" },
      { lookupKey: "me_builder_full_monthly", unitAmount: 1_480, interval: "month" },
      { lookupKey: "me_builder_full_yearly", unitAmount: 14_800, interval: "year" },
      { lookupKey: "me_builder_family_monthly", unitAmount: 2_980, interval: "month" },
      { lookupKey: "me_builder_family_yearly", unitAmount: 29_800, interval: "year" },
    ]);
    expect(api.webhooks[0]?.url).toBe("https://api.stg.kagami.kyosuke.dev/api/billing/webhook");
    expect(api.webhookEvents).toEqual(STRIPE_BILLING_EVENT_TYPES);
    expect(api.portals).toHaveLength(1);
    expect(result.webhookSecret).toBe("whsec_fixture");
    expect(result.pricePlanMap).toEqual({
      price_1: "lite",
      price_2: "lite",
      price_3: "full",
      price_4: "full",
      price_5: "family",
      price_6: "family",
    });
  });

  it("同じ設定で再実行しても商品、Price、Webhook、Portalを増やさない", async () => {
    const api = new FakeStripeCatalogApi();
    await setupStripeBillingCatalog({ api, environment: "preview" });
    const second = await setupStripeBillingCatalog({ api, environment: "preview" });

    expect(api.products).toHaveLength(3);
    expect(api.prices).toHaveLength(6);
    expect(api.webhooks).toHaveLength(1);
    expect(api.portals).toHaveLength(1);
    expect(second.webhookSecret).toBeNull();
  });

  it("価格変更時はlookup keyを新Priceへ移し、旧契約用PriceもPlan mapへ残す", async () => {
    const api = new FakeStripeCatalogApi();
    await setupStripeBillingCatalog({ api, environment: "preview" });
    const liteMonthly = api.prices.find((price) => price.lookupKey === "me_builder_lite_monthly");
    if (!liteMonthly) throw new Error("fixture price is missing");
    api.prices = api.prices.map((price) =>
      price.id === liteMonthly.id ? { ...price, unitAmount: 700 } : price,
    );

    const result = await setupStripeBillingCatalog({ api, environment: "preview" });
    const current = api.prices.find((price) => price.lookupKey === "me_builder_lite_monthly");

    expect(current?.unitAmount).toBe(780);
    expect(api.archivedPriceIds).toContain(liteMonthly.id);
    expect(result.pricePlanMap[liteMonthly.id]).toBe("lite");
    expect(current && result.pricePlanMap[current.id]).toBe("lite");
    expect(api.createdPriceSpecs.at(-1)?.transferLookupKey).toBe(true);
  });

  it("管理外の固定Product IDを上書きしない", async () => {
    const api = new FakeStripeCatalogApi();
    const firstProduct = STRIPE_BILLING_CATALOG[0];
    if (!firstProduct) throw new Error("Expected a billing product");
    api.products.push({ id: firstProduct.productId, metadata: {} });

    await expect(setupStripeBillingCatalog({ api, environment: "preview" })).rejects.toThrow(
      "exists but is not managed",
    );
  });

  it("管理外のlookup keyを上書きしない", async () => {
    const api = new FakeStripeCatalogApi();
    api.prices.push({
      id: "price_manual",
      active: true,
      productId: "prod_manual",
      currency: "jpy",
      unitAmount: 780,
      interval: "month",
      intervalCount: 1,
      taxBehavior: "inclusive",
      lookupKey: "me_builder_lite_monthly",
      metadata: {},
    });

    await expect(setupStripeBillingCatalog({ api, environment: "preview" })).rejects.toThrow(
      "lookup key me_builder_lite_monthly exists but is not managed",
    );
  });

  it("古いAPI versionのWebhookを新endpointへローテーションする", async () => {
    const api = new FakeStripeCatalogApi();
    api.webhooks.push({
      id: "we_old",
      url: "https://api.stg.kagami.kyosuke.dev/api/billing/webhook",
      apiVersion: "2025-10-29.clover",
      status: "enabled",
      metadata: { managed_by: "me-builder-stripe-catalog" },
    });

    const result = await setupStripeBillingCatalog({ api, environment: "preview" });

    expect(api.webhooks.find(({ id }) => id === "we_old")?.status).toBe("disabled");
    expect(api.webhooks.filter(({ status }) => status === "enabled")).toHaveLength(1);
    expect(result.webhookSecret).toBe("whsec_fixture");
    expect(result.created).toContain("webhook:rotated-api-version");
  });

  it("Cloudflareにsecretが無い場合はWebhookをローテーションして再取得できる", async () => {
    const api = new FakeStripeCatalogApi();
    await setupStripeBillingCatalog({ api, environment: "preview" });

    const result = await setupStripeBillingCatalog({
      api,
      environment: "preview",
      rotateWebhookSecret: true,
    });

    expect(api.webhooks.filter(({ status }) => status === "enabled")).toHaveLength(1);
    expect(result.webhookSecret).toBe("whsec_fixture");
    expect(result.created).toContain("webhook:rotated-secret");
  });

  it("同じWebhook URLが複数ある場合は配送重複を作らず停止する", async () => {
    const api = new FakeStripeCatalogApi();
    const url = "https://api.stg.kagami.kyosuke.dev/api/billing/webhook";
    api.webhooks.push(
      { id: "we_1", url, apiVersion: "2026-07-29.dahlia", status: "enabled", metadata: {} },
      { id: "we_2", url, apiVersion: "2026-07-29.dahlia", status: "enabled", metadata: {} },
    );

    await expect(setupStripeBillingCatalog({ api, environment: "preview" })).rejects.toThrow(
      "Multiple Stripe resources match webhook",
    );
  });
});
