import * as v from "valibot";
import { createHttpClient } from "../../../infrastructure/http-client";

const SurveyListItemSchema = v.object({
  id: v.pipe(v.string(), v.nonEmpty()),
  title: v.pipe(v.string(), v.nonEmpty()),
  description: v.pipe(v.string(), v.nonEmpty()),
  opensAt: v.pipe(v.string(), v.isoTimestamp()),
  closesAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  availability: v.picklist(["open", "closed"]),
  responseStatus: v.picklist(["unanswered", "in-progress", "answered"]),
  answeredCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  questionCount: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
});

const SurveyListResponseSchema = v.object({
  surveys: v.array(SurveyListItemSchema),
});

export type SurveyListItem = v.InferOutput<typeof SurveyListItemSchema>;

/** LIFF IDトークンで本人確認し、回答進捗を含むアンケート一覧を取得する。 */
export async function fetchSurveyList(
  apiUrl: string | undefined,
  idToken: string,
  signal?: AbortSignal,
): Promise<SurveyListItem[]> {
  const response = await createHttpClient(apiUrl).request("/api/surveys", {
    headers: { Authorization: `Bearer ${idToken}` },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("本人確認に失敗しました。LINEから開き直してください。");
    }
    if (response.status === 404) {
      throw new Error("アンケートを利用するには、先にLINE公式アカウントを友だち追加してください。");
    }
    throw new Error(`アンケート一覧の取得に失敗しました (HTTP ${response.status})`);
  }

  return v.parse(SurveyListResponseSchema, await response.json()).surveys;
}
