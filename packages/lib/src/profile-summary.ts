export type ProfileSummarySource = "diagnosis" | "diary";

export type ProfileSummaryInsight = Readonly<{
  key: string;
  label: string;
  description: string;
  evidenceCount: number;
  sources: readonly ProfileSummarySource[];
}>;

export type CompatibilityShareStatement = Readonly<{
  key: string;
  label: string;
  statement: string;
}>;

/** AI出力の検証後だけ使う。根拠IDはAccountData内に保存し、HTTPへ公開しない。 */
export type GeneratedCompatibilityShareStatement = CompatibilityShareStatement &
  Readonly<{ evidenceIds: readonly string[] }>;

export type CompatibilityShareProfile = Readonly<{
  profileSummaryVersionId: string;
  generatedAt: string;
  statements: readonly CompatibilityShareStatement[];
  fingerprint: string;
}>;

export type CompatibilityShareProfileReadResult =
  | Readonly<{ type: "available"; profile: CompatibilityShareProfile }>
  | Readonly<{ type: "unavailable" }>
  | Readonly<{ type: "stale" }>;

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

export type ProfileSummaryRegenerationReason = "diagnosis" | "brain" | "format" | "elapsed";

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
      needsDispatch: boolean;
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
  compatibilityShareStatements: readonly GeneratedCompatibilityShareStatement[];
  diagnosisCount: number;
  diaryCount: number;
  latestRecordedAt: Date | null;
  inputSnapshot: ProfileSummaryInputSnapshot;
}>;

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 同意した共有プロフィール版と表示文章を照合する、外部非公開の指紋を作る。 */
export async function createCompatibilityShareProfileFingerprint(
  profileSummaryVersionId: string,
  statements: readonly CompatibilityShareStatement[],
): Promise<string> {
  const canonical = JSON.stringify({ schemaVersion: 1, profileSummaryVersionId, statements });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return bytesToHex(digest);
}
