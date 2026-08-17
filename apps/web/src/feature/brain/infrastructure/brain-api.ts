import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createAuthenticatedHttpClient } from "../../../infrastructure/http-client";
import type {
  DevelopmentBrainItemsResult,
  DevelopmentBrainVectorResult,
} from "../model/brain-item";

type ApiDevelopmentBrainItemsResponse =
  operations["getDevelopmentBrainItems"]["responses"][200]["content"]["application/json"];
type ApiDevelopmentBrainVectorResponse =
  operations["getDevelopmentBrainVector"]["responses"][200]["content"]["application/json"];

const ResponseSchema = v.object({
  items: v.array(
    v.object({
      id: v.pipe(v.string(), v.nonEmpty()),
      category: v.pipe(v.string(), v.nonEmpty()),
      statement: v.pipe(v.string(), v.nonEmpty()),
      derivation: v.picklist(["ai", "deterministic"]),
      status: v.literal("active"),
      createdAt: v.pipe(v.string(), v.isoTimestamp()),
      firstObservedAt: v.pipe(v.string(), v.isoTimestamp()),
      lastObservedAt: v.pipe(v.string(), v.isoTimestamp()),
      vectorSync: v.object({
        status: v.picklist([
          "pending",
          "submitted",
          "retry_scheduled",
          "applied",
          "failed",
          "not-scheduled",
        ]),
        operation: v.exactOptional(v.picklist(["upsert", "delete"])),
        attemptCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
        updatedAt: v.exactOptional(v.pipe(v.string(), v.isoTimestamp())),
        nextAttemptAt: v.exactOptional(v.pipe(v.string(), v.isoTimestamp())),
        failureCode: v.exactOptional(v.pipe(v.string(), v.nonEmpty())),
        hasEntry: v.boolean(),
        entryRevision: v.exactOptional(v.pipe(v.number(), v.safeInteger(), v.minValue(0))),
      }),
      evidence: v.array(
        v.object({
          sourceRecordId: v.pipe(v.string(), v.nonEmpty()),
          relation: v.picklist(["supports", "contradicts"]),
          derivationMethod: v.picklist(["ai", "deterministic"]),
          generatedAt: v.pipe(v.string(), v.isoTimestamp()),
          recordedAt: v.pipe(v.string(), v.isoTimestamp()),
        }),
      ),
    }),
  ),
  truncated: v.boolean(),
}) satisfies v.GenericSchema<ApiDevelopmentBrainItemsResponse>;

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
      category: v.exactOptional(v.pipe(v.string(), v.nonEmpty())),
      derivation: v.exactOptional(v.picklist(["ai", "deterministic"])),
      embeddingVersion: v.exactOptional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
      schemaVersion: v.exactOptional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
    }),
    checkedAt: v.pipe(v.string(), v.isoTimestamp()),
  }),
]) satisfies v.GenericSchema<ApiDevelopmentBrainVectorResponse>;

export async function fetchDevelopmentBrainItems(
  apiUrl: string | undefined,
  signal?: AbortSignal,
): Promise<DevelopmentBrainItemsResult> {
  const response = await createAuthenticatedHttpClient(apiUrl).request("/api/dev/brain-items", {
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

  const body: ApiDevelopmentBrainItemsResponse = v.parse(ResponseSchema, await response.json());
  return body;
}

export async function fetchDevelopmentBrainVector(
  apiUrl: string | undefined,
  brainItemId: string,
  signal?: AbortSignal,
): Promise<DevelopmentBrainVectorResult> {
  const response = await createAuthenticatedHttpClient(apiUrl).request(
    `/api/dev/brain-items/${encodeURIComponent(brainItemId)}/vector`,
    {
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
  const body: ApiDevelopmentBrainVectorResponse = v.parse(
    VectorResponseSchema,
    await response.json(),
  );
  return body;
}
