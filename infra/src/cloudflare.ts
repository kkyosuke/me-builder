import { resourceNames } from "./environment";
import { parseManifest } from "./manifest";
import { requireCloudflareEnvironment, run } from "./process";

type ApiResponse<T> = {
  success: boolean;
  result: T;
  errors?: { message: string }[];
};

async function cloudflareResponse<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const { token } = requireCloudflareEnvironment();
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init?.headers },
  });
  const body = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !body.success) {
    throw new Error(
      `Cloudflare API ${response.status}: ${body.errors?.map(({ message }) => message).join(", ") || "unknown error"}`,
    );
  }
  return body;
}

async function cloudflare<T>(path: string, init?: RequestInit): Promise<T> {
  return (await cloudflareResponse<T>(path, init)).result;
}

function encodeR2ObjectKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

async function emptyPreviewBucket(bucketName: string): Promise<void> {
  const { accountId } = requireCloudflareEnvironment();
  const remote = await cloudflare<{ buckets?: { name?: string }[] }>(
    `/accounts/${accountId}/r2/buckets?per_page=1000&name_contains=${bucketName}`,
  );
  if (!remote.buckets?.some(({ name }) => name === bucketName)) return;

  while (true) {
    const objects = await cloudflare<{ key?: string }[]>(
      `/accounts/${accountId}/r2/buckets/${bucketName}/objects?per_page=1000`,
    );
    if (objects.length === 0) break;
    for (const object of objects) {
      if (!object.key) throw new Error("Cloudflare returned an R2 object without a key");
      await cloudflare(
        `/accounts/${accountId}/r2/buckets/${bucketName}/objects/${encodeR2ObjectKey(object.key)}`,
        { method: "DELETE" },
      );
    }
  }
  console.info(`Emptied Preview R2 bucket: ${bucketName}`);
}

async function deleteWorker(scriptName: string, attempts = 1) {
  const { accountId } = requireCloudflareEnvironment();
  try {
    await cloudflare(`/accounts/${accountId}/workers/scripts/${scriptName}`, { method: "DELETE" });
    console.info(`Deleted Worker: ${scriptName}`);
  } catch (error) {
    const message = String(error);
    if (message.includes("404")) {
      console.info(`Worker already absent: ${scriptName}`);
      return;
    }
    if (attempts < 7 && message.includes("consumer for a Queue")) {
      await Bun.sleep(5_000);
      return deleteWorker(scriptName, attempts + 1);
    }
    throw error;
  }
}

async function workerExists(scriptName: string) {
  const { accountId, token } = requireCloudflareEnvironment();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/settings`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (response.status === 404) return false;
  if (!response.ok)
    throw new Error(`Cloudflare API ${response.status}: failed to inspect ${scriptName}`);
  return true;
}

export async function deletePreviewDependents() {
  const { accountId } = requireCloudflareEnvironment();
  await deleteWorker("me-builder-api-preview");
  await deleteWorker("me-builder-mcp-preview");
  await emptyPreviewBucket(resourceNames("preview").avatarBucket);
  await emptyPreviewBucket(resourceNames("preview").photoDiaryBucket);

  const queues = await cloudflare<{ queue_id: string; queue_name: string }[]>(
    `/accounts/${accountId}/queues?per_page=100`,
  );
  for (const queue of queues) {
    const consumers = await cloudflare<{ consumer_id: string; script?: string }[]>(
      `/accounts/${accountId}/queues/${queue.queue_id}/consumers`,
    );
    for (const consumer of consumers.filter(
      ({ script }) => script === "me-builder-worker-preview",
    )) {
      await cloudflare(
        `/accounts/${accountId}/queues/${queue.queue_id}/consumers/${consumer.consumer_id}`,
        { method: "DELETE" },
      );
      console.info(`Deleted Queue consumer: ${queue.queue_name}`);
    }
  }
  if (await workerExists("me-builder-worker-preview")) {
    await run(["bun", "wrangler", "deploy", "--config", "wrangler.cleanup-preview.toml"]);
    await deleteWorker("me-builder-worker-preview");
  }
}

export async function deleteUnmanagedPreviewFoundation() {
  const { accountId } = requireCloudflareEnvironment();
  const names = resourceNames("preview");
  const queues = await cloudflare<{ queue_id: string; queue_name: string }[]>(
    `/accounts/${accountId}/queues?per_page=100`,
  );
  for (const queue of queues.filter(({ queue_name }) =>
    /^me-builder-.+-preview$/.test(queue_name),
  )) {
    await cloudflare(`/accounts/${accountId}/queues/${queue.queue_id}`, { method: "DELETE" });
    console.info(`Deleted unmanaged Queue: ${queue.queue_name}`);
  }

  const databases = await cloudflare<{ uuid: string; name: string }[]>(
    `/accounts/${accountId}/d1/database?per_page=100`,
  );
  for (const database of databases.filter(({ name }) => name === names.database)) {
    await cloudflare(`/accounts/${accountId}/d1/database/${database.uuid}`, { method: "DELETE" });
    console.info(`Deleted unmanaged D1 database: ${database.name}`);
  }

  for (const bucketName of [names.avatarBucket, names.photoDiaryBucket]) {
    const remoteBuckets = await cloudflare<{ buckets?: { name?: string }[] }>(
      `/accounts/${accountId}/r2/buckets?per_page=1000&name_contains=${bucketName}`,
    );
    if (remoteBuckets.buckets?.some(({ name }) => name === bucketName)) {
      await cloudflare(`/accounts/${accountId}/r2/buckets/${bucketName}`, {
        method: "DELETE",
      });
      console.info(`Deleted unmanaged R2 bucket: ${bucketName}`);
    }
  }
}

export async function discoverPreviewInfrastructure(baseDomain: string) {
  const { accountId } = requireCloudflareEnvironment();
  const names = resourceNames("preview");
  const databases = await cloudflare<{ uuid: string; name: string }[]>(
    `/accounts/${accountId}/d1/database?per_page=100`,
  );
  const database = databases.find(({ name }) => name === names.database);
  if (!database) throw new Error(`Missing D1 database: ${names.database}`);

  const remoteBuckets = await cloudflare<{ buckets?: { name?: string }[] }>(
    `/accounts/${accountId}/r2/buckets?per_page=1000&name_contains=${names.avatarBucket}`,
  );
  const avatarBucket = remoteBuckets.buckets?.find(({ name }) => name === names.avatarBucket);
  if (!avatarBucket?.name) throw new Error(`Missing Avatar R2 bucket: ${names.avatarBucket}`);
  const remotePhotoBuckets = await cloudflare<{ buckets?: { name?: string }[] }>(
    `/accounts/${accountId}/r2/buckets?per_page=1000&name_contains=${names.photoDiaryBucket}`,
  );
  const photoDiaryBucket = remotePhotoBuckets.buckets?.find(
    ({ name }) => name === names.photoDiaryBucket,
  );
  if (!photoDiaryBucket?.name) {
    throw new Error(`Missing Photo Diary R2 bucket: ${names.photoDiaryBucket}`);
  }

  const namespaces = await cloudflare<{ id: string; title: string }[]>(
    `/accounts/${accountId}/storage/kv/namespaces?per_page=1000`,
  );
  const sessionStore = namespaces.find(({ title }) => title === names.sessionStore);
  if (!sessionStore) throw new Error(`Missing Session KV namespace: ${names.sessionStore}`);

  const remoteQueues = await cloudflare<{ queue_id: string; queue_name: string }[]>(
    `/accounts/${accountId}/queues?per_page=100`,
  );
  return parseManifest({
    environment: "preview",
    baseDomain,
    database: { id: database.uuid, name: database.name },
    avatarBucket: { name: avatarBucket.name },
    photoDiaryBucket: { name: photoDiaryBucket.name },
    sessionStore: { id: sessionStore.id, name: sessionStore.title },
    queues: Object.fromEntries(
      Object.entries(names.queues).map(([key, name]) => {
        const queue = remoteQueues.find(({ queue_name }) => queue_name === name);
        if (!queue) throw new Error(`Missing Queue: ${name}`);
        return [key, { id: queue.queue_id, name: queue.queue_name }];
      }),
    ),
  });
}
