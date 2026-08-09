import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createHttpClient } from "../../../infrastructure/http-client";
import type { DevelopmentBrainItemsResult } from "../model/brain-item";

type ApiResponse =
  operations["getDevelopmentBrainItems"]["responses"][200]["content"]["application/json"];

const ResponseSchema = v.object({
  items: v.array(
    v.object({
      id: v.pipe(v.string(), v.nonEmpty()),
      category: v.pipe(v.string(), v.nonEmpty()),
      statement: v.pipe(v.string(), v.nonEmpty()),
      derivation: v.picklist(["ai", "deterministic"]),
      status: v.literal("active"),
      createdAt: v.pipe(v.string(), v.isoTimestamp()),
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
}) satisfies v.GenericSchema<ApiResponse>;

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
