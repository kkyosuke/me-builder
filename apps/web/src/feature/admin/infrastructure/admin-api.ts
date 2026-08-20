import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createAuthenticatedHttpClient } from "../../../infrastructure/http-client";
import type { AdminAccountFilters, AdminAccountPage } from "../model/account";
import type { AdminStatistics } from "../model/statistics";

type ApiResponse =
  operations["getAdminStatistics"]["responses"][200]["content"]["application/json"];
type AccountsApiResponse =
  operations["listAdminAccounts"]["responses"][200]["content"]["application/json"];

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
      requestCount: v.number(),
      inputTokens: v.number(),
      outputTokens: v.number(),
      costEstimate: v.union([
        v.object({
          status: v.literal("available"),
          currency: v.literal("USD"),
          amount: v.number(),
          pricingAsOf: v.string(),
        }),
        v.object({
          status: v.literal("unavailable"),
          issues: v.array(
            v.object({
              reason: v.picklist(["unsupported-model", "invalid-usage", "overflow"]),
              models: v.array(v.string()),
            }),
          ),
        }),
      ]),
      accounts: v.array(
        v.object({
          accountId: v.string(),
          requestCount: v.number(),
          inputTokens: v.number(),
          outputTokens: v.number(),
          estimatedCostUsd: v.nullable(v.number()),
        }),
      ),
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

const CountSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const AccountsResponseSchema = v.object({
  accounts: v.array(
    v.object({
      adminReference: v.pipe(v.string(), v.regex(/^account_[0-9a-f]{24}$/)),
      role: v.picklist(["user", "admin"]),
      status: v.picklist(["active", "stopped"]),
      createdAt: v.pipe(v.string(), v.isoTimestamp()),
      lastActivityAt: v.pipe(v.string(), v.isoTimestamp()),
      plan: v.picklist(["free", "lite", "full", "family"]),
      progression: v.union([
        v.object({ status: v.literal("pending") }),
        v.object({
          status: v.literal("ready"),
          level: v.pipe(CountSchema, v.minValue(1)),
          calculationVersion: v.pipe(CountSchema, v.minValue(1)),
          collectedPieces: CountSchema,
          activePieces: CountSchema,
          lastGrowthAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
          projectedAt: v.pipe(v.string(), v.isoTimestamp()),
        }),
      ]),
    }),
  ),
  total: CountSchema,
  nextCursor: v.nullable(v.string()),
}) satisfies v.GenericSchema<AccountsApiResponse>;

export async function fetchAdminStatistics(
  apiUrl: string | undefined,
  signal?: AbortSignal,
): Promise<AdminStatistics> {
  const response = await createAuthenticatedHttpClient(apiUrl).request("/api/admin/statistics", {
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    if (response.status === 403) throw new Error("この画面を表示する管理者権限がありません。");
    if (response.status === 401)
      throw new Error("本人確認の有効期限が切れました。もう一度お試しください。");
    throw new Error(`統計情報の取得に失敗しました (HTTP ${response.status})`);
  }
  return v.parse(ResponseSchema, await response.json());
}

export async function fetchAdminAccounts(
  apiUrl: string | undefined,
  filters: AdminAccountFilters,
  cursor?: string,
  signal?: AbortSignal,
): Promise<AdminAccountPage> {
  const query = new URLSearchParams();
  if (filters.query.trim()) query.set("query", filters.query.trim());
  if (filters.role !== "all") query.set("role", filters.role);
  if (filters.status !== "all") query.set("status", filters.status);
  if (filters.sort !== "created") query.set("sort", filters.sort);
  if (cursor) query.set("cursor", cursor);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await createAuthenticatedHttpClient(apiUrl).request(
    `/api/admin/accounts${suffix}`,
    {
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) {
    if (response.status === 403) throw new Error("この画面を表示する管理者権限がありません。");
    if (response.status === 401) {
      throw new Error("本人確認の有効期限が切れました。もう一度お試しください。");
    }
    if (response.status === 400) throw new Error("検索条件を確認してください。");
    throw new Error(`Account一覧の取得に失敗しました (HTTP ${response.status})`);
  }
  return v.parse(AccountsResponseSchema, await response.json());
}
