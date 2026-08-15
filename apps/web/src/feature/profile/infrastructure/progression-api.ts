import * as v from "valibot";
import type { operations } from "../../../generated/api";
import { createHttpClient } from "../../../infrastructure/http-client";
import type { UtsushiProgression } from "../model/progression";

type ApiResponse =
  operations["getProfileProgression"]["responses"][200]["content"]["application/json"];

const CountSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const ResponseSchema = v.object({
  level: v.pipe(CountSchema, v.minValue(1)),
  growthValue: CountSchema,
  currentLevelThreshold: CountSchema,
  nextLevelThreshold: CountSchema,
  collectedPieces: CountSchema,
  activePieces: CountSchema,
  categoryCount: CountSchema,
  calculationVersion: v.pipe(CountSchema, v.minValue(1)),
  highestLevel: v.pipe(CountSchema, v.minValue(1)),
}) satisfies v.GenericSchema<ApiResponse>;

export async function fetchProfileProgression(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<UtsushiProgression> {
  const response = await createHttpClient(apiUrl).request("/api/profile/progression", {
    headers: { Authorization: `Bearer ${idToken}` },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("本人確認に失敗しました。LINEから開き直してください。");
    }
    if (response.status === 404) {
      throw new Error("利用するには、先にLINE公式アカウントを友だち追加してください。");
    }
    throw new Error(`うつしレベルの取得に失敗しました (HTTP ${response.status})`);
  }
  return v.parse(ResponseSchema, await response.json());
}
