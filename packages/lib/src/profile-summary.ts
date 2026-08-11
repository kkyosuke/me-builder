export type ProfileSummarySource = "diagnosis" | "diary";

export type ProfileSummaryInsight = Readonly<{
  key: string;
  label: string;
  description: string;
  evidenceCount: number;
  sources: readonly ProfileSummarySource[];
}>;

export type ProfileSummaryContent = Readonly<{
  generatedAt: string;
  headline: string;
  insights: readonly ProfileSummaryInsight[];
  recordCount: number;
  diagnosisCount: number;
  diaryCount: number;
  latestRecordedAt: string | null;
}>;

export type ProfileSummaryVersion = Readonly<{
  id: string;
  sequence: number;
  generatedAt: string;
  isLatest: boolean;
  generationMethod: "ai";
  summary: ProfileSummaryContent;
}>;

export type ProfileSummaryGenerationState = Readonly<{
  status: "idle" | "queued" | "generating" | "failed";
  canRegenerate: boolean;
  reasons: readonly ProfileSummaryRegenerationReason[];
  message: string | null;
}>;

export type ProfileSummaryRegenerationReason = "diagnosis" | "brain" | "elapsed";

export type ProfileSummaryInputSnapshot = Readonly<{
  diagnosis: Readonly<{ count: number; latestRecordedAt: Date | null }>;
  diary: Readonly<{ count: number; latestRecordedAt: Date | null }>;
}>;

export type ProfileSummaryReadModel = Readonly<{
  versions: readonly ProfileSummaryVersion[];
  availableDataCounts: Readonly<{ diagnosis: number; diary: number }>;
  generation: ProfileSummaryGenerationState;
}>;

export type ProfileSummaryEvidence = Readonly<{
  id: string;
  source: ProfileSummarySource;
  text: string;
  recordedAt: Date;
}>;

export type ProfileSummaryGenerationContext = Readonly<{
  generationId: string;
  evidence: readonly ProfileSummaryEvidence[];
  diagnosisCount: number;
  diaryCount: number;
  latestRecordedAt: Date | null;
  inputSnapshot: ProfileSummaryInputSnapshot;
}>;

export type RequestProfileSummaryGenerationResult =
  | Readonly<{
      outcome: "created" | "existing";
      generationId: string;
      status: "queued" | "generating";
    }>
  | Readonly<{
      outcome: "unavailable";
      reason: "source_record_required" | "regeneration_not_required";
    }>;

export type CompleteProfileSummaryGenerationInput = Readonly<{
  generationId: string;
  generatedAt: Date;
  model: string;
  promptVersion: string;
  headline: string;
  insights: readonly ProfileSummaryInsight[];
  diagnosisCount: number;
  diaryCount: number;
  latestRecordedAt: Date | null;
  inputSnapshot: ProfileSummaryInputSnapshot;
}>;
