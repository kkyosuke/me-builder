export type ProfileRecordSource = "diagnosis" | "diary";

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
  recordCount: number;
  diagnosisCount: number;
  diaryCount: number;
  latestRecordedAt: string | null;
}>;

export type ProfileSummaryResult = Readonly<{
  summary: ProfileSummary | null;
  nextAction: "diagnosis" | "chat";
}>;

type ProfileSummaryVersionOption = Readonly<{
  id: string;
  sequence: number | null;
  generatedAt: string;
  isLatest: boolean;
  generationMethod: "ai" | "deterministic";
}>;

export type ProfileSummaryRegenerationReason = "diagnosis" | "brain" | "elapsed";

type ProfileSummaryGenerationState = Readonly<{
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
