type WeeklyReflection = Readonly<{
  weekStart: string;
  generatedAt: string;
  headline: string;
  items: readonly Readonly<{
    kind: "pattern" | "value" | "next-step" | "question";
    title: string;
    description: string;
    evidenceCount: number;
    sources: readonly ("diagnosis" | "diary")[];
  }>[];
  recordCount: number;
}>;

export type WeeklyReflectionResult = Readonly<{
  reflections: readonly WeeklyReflection[];
  monthlyChanges: readonly Readonly<{
    month: string;
    version: number;
    generatedAt: string;
    mode: "brief" | "full" | "archived";
    headline: string;
    previousMonthHeadline: string | null;
    changes: readonly string[];
    ongoingGoals: readonly string[];
    evidenceWeekStarts: readonly string[];
  }>[];
  generation: Readonly<{
    weekStart: string;
    status: "idle" | "queued" | "generating" | "completed" | "failed";
    canGenerate: boolean;
    message: string | null;
    notification: "pending" | "skipped" | "not-applicable";
  }>;
  canStartNew: boolean;
}>;
