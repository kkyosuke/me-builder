import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createHttpClient } from "../../../infrastructure/http-client";
import type { ProfileEntitlement } from "../model/entitlement";

type ApiResponse =
  operations["getProfileEntitlement"]["responses"][200]["content"]["application/json"];

const CountSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const UsageSchema = v.object({
  limit: CountSchema,
  used: CountSchema,
  reserved: CountSchema,
  remaining: CountSchema,
  periodStartsAt: v.pipe(v.string(), v.isoTimestamp()),
  resetsAt: v.pipe(v.string(), v.isoTimestamp()),
});
const ResponseSchema = v.object({
  status: v.picklist(["free", "active", "safe-default"]),
  plan: v.picklist(["free", "lite", "full", "family"]),
  source: v.picklist(["free", "subscription", "family-seat"]),
  effectiveAt: v.pipe(v.string(), v.isoTimestamp()),
  availableUntil: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  aiReply: UsageSchema,
  profileSummary: UsageSchema,
}) satisfies v.GenericSchema<ApiResponse>;

export async function fetchProfileEntitlement(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<ProfileEntitlement> {
  const response = await createHttpClient(apiUrl).request("/api/profile/entitlement", {
    headers: { Authorization: `Bearer ${idToken}` },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("本人確認に失敗しました。LINEから開き直してください。");
    }
    throw new Error(`利用状況の取得に失敗しました (HTTP ${response.status})`);
  }
  return v.parse(ResponseSchema, await response.json());
}
