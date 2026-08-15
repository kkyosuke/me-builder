export type WeeklyReflectionSource = "diagnosis" | "diary";

export type WeeklyReflectionItem = Readonly<{
  kind: "pattern" | "value" | "next-step" | "question";
  title: string;
  description: string;
  evidenceCount: number;
  sources: readonly WeeklyReflectionSource[];
}>;

export type WeeklyReflectionContent = Readonly<{
  weekStart: string;
  generatedAt: string;
  headline: string;
  items: readonly WeeklyReflectionItem[];
  recordCount: number;
}>;

export type WeeklyReflectionGenerationState = Readonly<{
  weekStart: string;
  status: "idle" | "queued" | "generating" | "completed" | "failed";
  canGenerate: boolean;
  message: string | null;
  notification: "pending" | "skipped" | "not-applicable";
}>;

export type WeeklyReflectionReadModel = Readonly<{
  reflections: readonly WeeklyReflectionContent[];
  generation: WeeklyReflectionGenerationState;
}>;

export type WeeklyReflectionEvidence = Readonly<{
  id: string;
  source: WeeklyReflectionSource;
  text: string;
  recordedAt: Date;
}>;

export type WeeklyReflectionGenerationContext = Readonly<{
  generationId: string;
  weekStart: string;
  evidence: readonly WeeklyReflectionEvidence[];
}>;

export type RequestWeeklyReflectionGenerationResult =
  | Readonly<{
      outcome: "created" | "existing" | "retried";
      generationId: string;
      status: "queued" | "generating" | "completed";
      needsDispatch: boolean;
    }>
  | Readonly<{ outcome: "unavailable"; reason: "source_record_required" }>;

export type CompleteWeeklyReflectionGenerationInput = Readonly<{
  generationId: string;
  generatedAt: Date;
  model: string;
  promptVersion: string;
  headline: string;
  items: readonly WeeklyReflectionItem[];
  evidenceCount: number;
}>;

/** Asia/Tokyoで、指定日時を含む週の月曜日をYYYY-MM-DDで返す。 */
export function resolveJstWeekStart(at = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const localDate = `${value("year")}-${value("month")}-${value("day")}`;
  const noonUtc = new Date(`${localDate}T12:00:00.000Z`);
  const mondayOffset = (noonUtc.getUTCDay() + 6) % 7;
  noonUtc.setUTCDate(noonUtc.getUTCDate() - mondayOffset);
  return noonUtc.toISOString().slice(0, 10);
}

export function jstWeekRange(weekStart: string): Readonly<{ from: Date; until: Date }> {
  const from = new Date(`${weekStart}T00:00:00+09:00`);
  const until = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1_000);
  return { from, until };
}
