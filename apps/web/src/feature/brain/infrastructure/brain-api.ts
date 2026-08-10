import * as v from "valibot";
import { createHttpClient } from "../../../infrastructure/http-client";
import type {
  DevelopmentBrainItemsResult,
  DevelopmentBrainVectorResult,
} from "../model/brain-item";

const ResponseSchema = v.object({
  items: v.array(
    v.object({
      id: v.pipe(v.string(), v.nonEmpty()),
      category: v.pipe(v.string(), v.nonEmpty()),
      statement: v.pipe(v.string(), v.nonEmpty()),
      derivation: v.picklist(["ai", "deterministic"]),
      status: v.literal("active"),
      createdAt: v.pipe(v.string(), v.isoTimestamp()),
      vectorSync: v.object({
        status: v.picklist(["pending", "submitted", "applied", "failed", "not-scheduled"]),
        operation: v.optional(v.picklist(["upsert", "delete"])),
        attemptCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
        updatedAt: v.optional(v.pipe(v.string(), v.isoTimestamp())),
        nextAttemptAt: v.optional(v.pipe(v.string(), v.isoTimestamp())),
        failureCode: v.optional(v.pipe(v.string(), v.nonEmpty())),
        hasEntry: v.boolean(),
        entryRevision: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(0))),
      }),
      evidence: v.array(
        v.object({
          sourceRecordId: v.pipe(v.string(), v.nonEmpty()),
          relation: v.picklist(["supports", "contradicts"]),
          derivationMethod: v.picklist(["ai", "deterministic"]),
          generatedAt: v.pipe(v.string(), v.isoTimestamp()),
        }),
      ),
    }),
  ),
  truncated: v.boolean(),
}) satisfies v.GenericSchema<DevelopmentBrainItemsResult>;

const VectorResponseSchema = v.variant("state", [
  v.object({ state: v.literal("not-synced"), checkedAt: v.pipe(v.string(), v.isoTimestamp()) }),
  v.object({
    state: v.literal("missing"),
    entryRevision: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    checkedAt: v.pipe(v.string(), v.isoTimestamp()),
  }),
  v.object({
    state: v.literal("present"),
    entryRevision: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    dimensions: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    metadata: v.object({
      category: v.optional(v.pipe(v.string(), v.nonEmpty())),
      derivation: v.optional(v.picklist(["ai", "deterministic"])),
      embeddingVersion: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
      schemaVersion: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
    }),
    checkedAt: v.pipe(v.string(), v.isoTimestamp()),
  }),
]) satisfies v.GenericSchema<DevelopmentBrainVectorResult>;

export async function fetchDevelopmentBrainItems(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<DevelopmentBrainItemsResult> {
  const response = await createHttpClient(apiUrl).request("/api/dev/brain-items", {
    headers: { Authorization: `Bearer ${idToken}` },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("本人確認に失敗しました。LINEから開き直してください。");
    }
    if (response.status === 404) {
      throw new Error("Brain Item一覧はこの環境では利用できません。");
    }
    throw new Error(`Brain Item一覧の取得に失敗しました (HTTP ${response.status})`);
  }

  return v.parse(ResponseSchema, await response.json());
}

export async function fetchDevelopmentBrainVector(
  apiUrl: string | undefined,
  idToken: string,
  brainItemId: string,
  signal?: AbortSignal,
): Promise<DevelopmentBrainVectorResult> {
  const response = await createHttpClient(apiUrl).request(
    `/api/dev/brain-items/${encodeURIComponent(brainItemId)}/vector`,
    {
      headers: { Authorization: `Bearer ${idToken}` },
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("本人確認に失敗しました。LINEから開き直してください。");
    }
    if (response.status === 404) {
      throw new Error("Vector確認はこの環境では利用できません。");
    }
    throw new Error(`Vector確認に失敗しました (HTTP ${response.status})`);
  }
  return v.parse(VectorResponseSchema, await response.json());
}
