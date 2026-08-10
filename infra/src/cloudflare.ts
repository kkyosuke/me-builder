import { resourceNames } from "./environment";
import { parseManifest } from "./manifest";
import { requireCloudflareEnvironment, run } from "./process";

type ApiResponse<T> = { success: boolean; result: T; errors?: { message: string }[] };

async function cloudflare<T>(path: string, init?: RequestInit) {
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
  return body.result;
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
}

export async function discoverPreviewInfrastructure() {
  const { accountId } = requireCloudflareEnvironment();
  const names = resourceNames("preview");
  const databases = await cloudflare<{ uuid: string; name: string }[]>(
    `/accounts/${accountId}/d1/database?per_page=100`,
  );
  const database = databases.find(({ name }) => name === names.database);
  if (!database) throw new Error(`Missing D1 database: ${names.database}`);

  const remoteQueues = await cloudflare<{ queue_id: string; queue_name: string }[]>(
    `/accounts/${accountId}/queues?per_page=100`,
  );
  return parseManifest({
    environment: "preview",
    database: { id: database.uuid, name: database.name },
    queues: Object.fromEntries(
      Object.entries(names.queues).map(([key, name]) => {
        const queue = remoteQueues.find(({ queue_name }) => queue_name === name);
        if (!queue) throw new Error(`Missing Queue: ${name}`);
        return [key, { id: queue.queue_id, name: queue.queue_name }];
      }),
    ),
  });
}
