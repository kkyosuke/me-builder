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
  diagnosisThemes?: readonly ProfileDiagnosisTheme[];
  nextAction: "diagnosis" | "chat";
}>;

export type ProfileDiagnosisTheme = Readonly<{
  id: string;
  title: string;
  lastAnsweredAt: string;
  answeredCount: number;
  questionCount: number;
  scoring: Readonly<{
    scoringVersion: number;
    balancedLabel: string;
    parameters: readonly Readonly<{
      id: string;
      label: string;
      lowLabel: string;
      highLabel: string;
      score: number | null;
      coverage: number;
      band: "low" | "balanced" | "high" | "insufficient";
    }>[];
  }> | null;
}>;

export type ProfileSummaryReadResult = ProfileSummaryResult &
  Readonly<{
    versions: readonly ProfileSummaryVersion[];
    availableDataCounts: Readonly<{ diagnosis: number; diary: number }>;
    generation: ProfileSummaryGenerationState;
    diagnosisThemes: readonly ProfileDiagnosisTheme[];
  }>;

type ProfileSummaryVersionOption = Readonly<{
  id: string;
  sequence: number | null;
  generatedAt: string;
  isLatest: boolean;
  generationMethod: "ai" | "deterministic";
}>;

type ProfileSummaryVersion = ProfileSummaryVersionOption & Readonly<{ summary: ProfileSummary }>;

export type ProfileSummaryRegenerationReason = "diagnosis" | "brain" | "format" | "elapsed";

export type ProfileSummaryGenerationUnavailableReason =
  | "source_record_required"
  | "regeneration_not_required";

export class ProfileSummaryGenerationUnavailableError extends Error {
  readonly reason: ProfileSummaryGenerationUnavailableReason;

  constructor(reason: ProfileSummaryGenerationUnavailableReason) {
    super(
      reason === "source_record_required"
        ? "まとめに使える記録がまだありません。"
        : "新しい情報がないため、再生成は必要ありません。",
    );
    this.name = "ProfileSummaryGenerationUnavailableError";
    this.reason = reason;
  }
}

type ProfileSummaryGenerationState = Readonly<{
  status: "idle" | "queued" | "generating" | "failed";
  canRegenerate: boolean;
  reasons: readonly ProfileSummaryRegenerationReason[];
  message?: string;
}>;

export type ProfileSummaryVersioning = Readonly<{
  versions: readonly ProfileSummaryVersion[];
  selectedVersionId: string | null;
  generation: ProfileSummaryGenerationState;
}>;
