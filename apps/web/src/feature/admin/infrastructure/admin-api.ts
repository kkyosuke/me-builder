import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createHttpClient } from "../../../infrastructure/http-client";
import type { AdminStatistics } from "../model/statistics";

type ApiResponse =
  operations["getAdminStatistics"]["responses"][200]["content"]["application/json"];

const UnavailableSchema = v.object({
  status: v.literal("unavailable"),
  reason: v.picklist(["not-configured", "upstream-error"]),
});
const ResponseSchema = v.object({
  period: v.object({
    start: v.pipe(v.string(), v.isoTimestamp()),
    end: v.pipe(v.string(), v.isoTimestamp()),
  }),
  fetchedAt: v.pipe(v.string(), v.isoTimestamp()),
  gemini: v.union([
    v.object({
      status: v.literal("available"),
      estimatedCostUsd: v.number(),
      requestCount: v.number(),
      inputTokens: v.number(),
      outputTokens: v.number(),
    }),
    UnavailableSchema,
  ]),
  line: v.union([
    v.object({
      status: v.literal("available"),
      billableMessages: v.number(),
      monthlyLimit: v.nullable(v.number()),
      replyMessages: v.number(),
    }),
    UnavailableSchema,
  ]),
}) satisfies v.GenericSchema<ApiResponse>;

export async function fetchAdminStatistics(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<AdminStatistics> {
  const response = await createHttpClient(apiUrl).request("/api/admin/statistics", {
    headers: { Authorization: `Bearer ${idToken}` },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    if (response.status === 403) throw new Error("この画面を表示する管理者権限がありません。");
    if (response.status === 401)
      throw new Error("本人確認に失敗しました。LINEから開き直してください。");
    throw new Error(`統計情報の取得に失敗しました (HTTP ${response.status})`);
  }
  return v.parse(ResponseSchema, await response.json());
}
