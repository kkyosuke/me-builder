import { type Environment, parseEnvironment, resourceNames } from "./environment";

export type QueueKey = keyof ReturnType<typeof resourceNames>["queues"];

export interface InfrastructureManifest {
  environment: Environment;
  database: { id: string; name: string };
  queues: Record<QueueKey, { id?: string; name: string }>;
}

export function parseManifest(input: unknown): InfrastructureManifest {
  if (!input || typeof input !== "object") {
    throw new Error("Infrastructure manifest must be an object");
  }
  const value = input as Record<string, unknown>;
  const environment = parseEnvironment(String(value.environment));
  const expected = resourceNames(environment);
  const database = value.database as Record<string, unknown> | undefined;
  if (!database || database.name !== expected.database || typeof database.id !== "string") {
    throw new Error(`Invalid D1 output for ${environment}`);
  }
  const inputQueues = value.queues as Record<string, Record<string, unknown>> | undefined;
  const queues = {} as InfrastructureManifest["queues"];
  for (const [key, name] of Object.entries(expected.queues)) {
    const queue = inputQueues?.[key];
    if (!queue || queue.name !== name || (queue.id !== undefined && typeof queue.id !== "string")) {
      throw new Error(`Invalid Queue output: ${key}`);
    }
    queues[key as QueueKey] = typeof queue.id === "string" ? { id: queue.id, name } : { name };
  }
  return { environment, database: { id: database.id, name: expected.database }, queues };
}
