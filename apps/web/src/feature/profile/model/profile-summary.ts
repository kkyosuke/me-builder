export type ProfileRecordSource = "diagnosis";

export type ProfileParameter = Readonly<{
  id: string;
  label: string;
  lowLabel: string;
  highLabel: string;
  score: number | null;
  coverage: number;
  evidenceCount: number;
  band: "low" | "balanced" | "high" | "insufficient";
}>;

export type ProfileTheme = Readonly<{
  diagnosisId: string;
  title: string;
  answerCount: number;
  lastAnsweredAt: string;
  scoring: Readonly<{
    balancedLabel: string;
    parameters: readonly ProfileParameter[];
  }> | null;
}>;

export type ProfileDiaryMemory = Readonly<{
  id: string;
  statement: string;
  recordedAt: string;
  evidenceCount: number;
}>;

export type ProfileSummary = Readonly<{
  generatedAt: string;
  headline: string;
  insights: readonly Readonly<{
    key: string;
    label: string;
    description: string;
    evidenceCount: number;
    sources: readonly ProfileRecordSource[];
  }>[];
  themes: readonly ProfileTheme[];
  diaryMemories: readonly ProfileDiaryMemory[];
  recordCount: number;
  diagnosisCount: number;
  diaryCount: number;
  latestRecordedAt: string | null;
}>;

export type ProfileSummaryResult = Readonly<{
  summary: ProfileSummary | null;
  nextAction: "diagnosis" | null;
}>;

export type ProfileSummaryVersionOption = Readonly<{
  id: string;
  sequence: number | null;
  generatedAt: string;
  isLatest: boolean;
  generationMethod: "ai" | "deterministic";
}>;

export type ProfileSummaryRegenerationReason = "diagnosis" | "brain" | "elapsed";

export type ProfileSummaryGenerationState = Readonly<{
  status: "idle" | "queued" | "generating" | "failed";
  canRegenerate: boolean;
  reasons: readonly ProfileSummaryRegenerationReason[];
  message?: string;
}>;

export type ProfileSummaryVersioning = Readonly<{
  versions: readonly ProfileSummaryVersionOption[];
  selectedVersionId: string;
  generation: ProfileSummaryGenerationState;
}>;
