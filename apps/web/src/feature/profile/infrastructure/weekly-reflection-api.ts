import * as v from "valibot";
import { createAuthenticatedHttpClient } from "../../../infrastructure/http-client";
import type { WeeklyReflectionResult } from "../model/weekly-reflection";

const Text = v.pipe(v.string(), v.nonEmpty());
const ResponseSchema = v.object({
  reflections: v.array(
    v.object({
      weekStart: v.pipe(v.string(), v.isoDate()),
      generatedAt: v.pipe(v.string(), v.isoTimestamp()),
      headline: Text,
      items: v.array(
        v.object({
          kind: v.picklist(["pattern", "value", "next-step", "question"]),
          title: Text,
          description: Text,
          evidenceCount: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
          sources: v.array(v.picklist(["diagnosis", "diary"])),
        }),
      ),
      recordCount: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    }),
  ),
  monthlyChanges: v.array(
    v.object({
      month: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}$/)),
      version: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
      generatedAt: v.pipe(v.string(), v.isoTimestamp()),
      mode: v.picklist(["brief", "full", "archived"]),
      headline: Text,
      previousMonthHeadline: v.nullable(Text),
      changes: v.array(Text),
      ongoingGoals: v.array(Text),
      evidenceWeekStarts: v.array(v.pipe(v.string(), v.isoDate())),
    }),
  ),
  generation: v.object({
    weekStart: v.pipe(v.string(), v.isoDate()),
    status: v.picklist(["idle", "queued", "generating", "completed", "failed"]),
    canGenerate: v.boolean(),
    message: v.nullable(Text),
    notification: v.picklist(["pending", "skipped", "not-applicable"]),
  }),
  canStartNew: v.boolean(),
}) satisfies v.GenericSchema<WeeklyReflectionResult>;

async function assertResponse(response: Response): Promise<Response> {
  if (response.ok) return response;
  if (response.status === 409) {
    const body = (await response.json()) as { reason?: string };
    if (body.reason === "feature_unavailable") {
      throw new Error("新しい週次振り返りはLite以上で利用できます。過去の結果は閲覧できます。");
    }
    if (body.reason === "source_record_required") {
      throw new Error("振り返りを作るには、診断または今週の日記が必要です。");
    }
  }
  throw new Error(`週次振り返りを取得できませんでした (HTTP ${response.status})`);
}

export async function fetchWeeklyReflections(
  apiUrl: string | undefined,
  signal?: AbortSignal,
): Promise<WeeklyReflectionResult> {
  const response = await assertResponse(
    await createAuthenticatedHttpClient(apiUrl).request("/api/weekly-reflections", {
      ...(signal ? { signal } : {}),
    }),
  );
  return v.parse(ResponseSchema, await response.json());
}

export async function startWeeklyReflection(
  apiUrl: string | undefined,
  signal?: AbortSignal,
): Promise<void> {
  await assertResponse(
    await createAuthenticatedHttpClient(apiUrl).request("/api/weekly-reflections/generations", {
      method: "POST",
      ...(signal ? { signal } : {}),
    }),
  );
}
