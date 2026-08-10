const RESET_CLASSES = ["AccountData", "CompatibilityData", "ConversationCoordinator"] as const;
type ResetClass = (typeof RESET_CLASSES)[number];

type CloudflareEnvelope<T> = {
  success?: boolean;
  result?: T;
  errors?: Array<{ message?: unknown }>;
  result_info?: { total_pages?: unknown; cursor?: unknown };
};

type Namespace = {
  id?: unknown;
  class?: unknown;
  script?: unknown;
  use_sqlite?: unknown;
};

type DurableObject = { id?: unknown; hasStoredData?: unknown };

export function selectResetNamespaces(payloads: unknown[]): Map<ResetClass, string> {
  const selected = new Map<ResetClass, string>();
  for (const payload of payloads) {
    const envelope = payload as CloudflareEnvelope<Namespace[]>;
    if (!envelope.success || !Array.isArray(envelope.result)) {
      throw new Error("Cloudflare returned an invalid Durable Object namespace response");
    }
    for (const namespace of envelope.result) {
      if (namespace.script !== "me-builder-worker-preview") continue;
      if (!RESET_CLASSES.includes(namespace.class as ResetClass)) continue;
      if (namespace.use_sqlite !== true || typeof namespace.id !== "string") {
        throw new Error("Preview Durable Object namespace is not SQLite-backed or has no ID");
      }
      const className = namespace.class as ResetClass;
      if (selected.has(className)) throw new Error(`Duplicate Preview namespace: ${className}`);
      selected.set(className, namespace.id);
    }
  }
  for (const className of RESET_CLASSES) {
    if (!selected.has(className)) throw new Error(`Preview namespace was not found: ${className}`);
  }
  return selected;
}

export function parseStoredObjectIds(payload: unknown): { ids: string[]; cursor?: string } {
  const envelope = payload as CloudflareEnvelope<DurableObject[]>;
  if (!envelope.success || !Array.isArray(envelope.result)) {
    throw new Error("Cloudflare returned an invalid Durable Object list response");
  }
  const ids = envelope.result
    .filter(({ hasStoredData }) => hasStoredData === true)
    .map(({ id }) => {
      if (typeof id !== "string" || id.length === 0) {
        throw new Error("Cloudflare returned an invalid Durable Object ID");
      }
      return id;
    });
  const cursor = envelope.result_info?.cursor;
  return { ids, ...(typeof cursor === "string" && cursor.length > 0 ? { cursor } : {}) };
}

export function chunkObjectIds(ids: string[], size = 50): string[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("Chunk size must be positive");
  return Array.from({ length: Math.ceil(ids.length / size) }, (_, index) =>
    ids.slice(index * size, (index + 1) * size),
  );
}

async function cloudflareGet<T>(path: string): Promise<CloudflareEnvelope<T>> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
  });
  const payload = (await response.json()) as CloudflareEnvelope<T>;
  if (!response.ok || !payload.success) {
    const message = payload.errors?.map(({ message }) => message).find(Boolean);
    throw new Error(
      typeof message === "string" ? message : `Cloudflare API failed: ${response.status}`,
    );
  }
  return payload;
}

async function listNamespaces(accountId: string): Promise<unknown[]> {
  const pages: unknown[] = [];
  for (let page = 1; ; page += 1) {
    const payload = await cloudflareGet<Namespace[]>(
      `/accounts/${accountId}/workers/durable_objects/namespaces?page=${page}&per_page=1000`,
    );
    pages.push(payload);
    const totalPages = payload.result_info?.total_pages;
    if (typeof totalPages !== "number" || page >= totalPages) return pages;
  }
}

async function listStoredObjectIds(accountId: string, namespaceId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ limit: "10000" });
    if (cursor) query.set("cursor", cursor);
    const payload = await cloudflareGet<DurableObject[]>(
      `/accounts/${accountId}/workers/durable_objects/namespaces/${namespaceId}/objects?${query}`,
    );
    const parsed = parseStoredObjectIds(payload);
    ids.push(...parsed.ids);
    cursor = parsed.cursor;
  } while (cursor);
  return ids;
}

async function resetObjects(className: ResetClass, objectIds: string[]): Promise<void> {
  for (const ids of chunkObjectIds(objectIds)) {
    const response = await fetch(
      `https://api.${process.env.BASE_DOMAIN}/api/internal/preview-reset/durable-objects`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PREVIEW_RESET_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ className, objectIds: ids }),
      },
    );
    if (!response.ok) throw new Error(`Preview DO reset endpoint failed: ${response.status}`);
  }
}

async function main(): Promise<void> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error("Cloudflare account ID and API token are required");
  }
  if (!process.env.PREVIEW_RESET_TOKEN || !process.env.BASE_DOMAIN) {
    throw new Error("Preview reset token and base domain are required");
  }

  const namespaces = selectResetNamespaces(await listNamespaces(accountId));
  for (const className of RESET_CLASSES) {
    const namespaceId = namespaces.get(className);
    if (!namespaceId) throw new Error(`Preview namespace was not found: ${className}`);
    const objectIds = await listStoredObjectIds(accountId, namespaceId);
    await resetObjects(className, objectIds);
    console.info(`Reset ${objectIds.length} ${className} objects without replacing the namespace.`);
  }
}

if (import.meta.main) await main();
