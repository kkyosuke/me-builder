import {
  type AccountDataNamespace,
  type CompatibilitySharePreviewDiagnosis,
  type CompatibilitySharePreviewTheme,
  type CompatibilityShareProfile,
  type D1,
  type DO,
  accountDataFor,
  buildCompatibilitySharePreviewThemes,
  createCompatibilitySharePreviewToken,
} from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { scoreDiagnosisAnswers } from "./diagnosis-scoring";
import { createLiffSession } from "./liff-session";

type CompatibilitySharePreviewContents = Readonly<{
  displayName: string | null;
  previewToken: string;
  aboutMe: {
    profileSummaryVersionId: string;
    generatedAt: string;
    statements: readonly { key: string; label: string; statement: string }[];
  } | null;
  themes: readonly CompatibilitySharePreviewTheme[];
  canIssueInvitation: boolean;
  blockingReasons: readonly CompatibilitySharePreviewBlockingReason[];
  nextAction: "diagnosis" | "profile-summary" | null;
}>;

export type CompatibilitySharePreviewOutcome =
  | {
      type: "resolved";
      preview: CompatibilitySharePreviewContents & { avatarUrl: string | null };
    }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

export type CompatibilitySharePreviewBlockingReason =
  | "display_name_unavailable"
  | "profile_summary_required"
  | "profile_summary_stale"
  | "diagnosis_required"
  | "scoring_unavailable"
  | "diagnosis_unavailable";

type Params = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData?: AccountDataNamespace;
  at?: Date;
};

export type CompatibilitySharePreviewData = Readonly<{
  displayName: string | null;
  shareProfile: CompatibilityShareProfile | null;
  shareableDiagnoses: readonly CompatibilitySharePreviewDiagnosis[];
  preview: CompatibilitySharePreviewContents;
}>;

export type CompatibilitySharePreviewDataDependencies = {
  getPreviewSource: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    at: Date,
  ) => ReturnType<typeof DO.account.action.diagnosis.getDiagnosisAnsweredSource>;
  getShareProfile: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    profileSummaryVersionId?: string,
  ) => ReturnType<typeof DO.account.action.profileSummary.readCompatibilityShareProfile>;
  scoreAnswers: typeof scoreDiagnosisAnswers;
  createPreviewToken: typeof createCompatibilitySharePreviewToken;
};

type Dependencies = CompatibilitySharePreviewDataDependencies & {
  createSession: typeof createLiffSession;
};

export const compatibilitySharePreviewDataDependencies: CompatibilitySharePreviewDataDependencies =
  {
    getPreviewSource: (accountData, accountId, at) => {
      if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
      return accountDataFor(accountData, accountId).execute("diagnosis.getAnsweredSource", at);
    },
    getShareProfile: (accountData, accountId, profileSummaryVersionId) => {
      if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
      return accountDataFor(accountData, accountId).execute(
        "profileSummary.readCompatibilityShareProfile",
        profileSummaryVersionId,
      );
    },
    scoreAnswers: scoreDiagnosisAnswers,
    createPreviewToken: createCompatibilitySharePreviewToken,
  };

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  ...compatibilitySharePreviewDataDependencies,
};

/** 認証済みAccountの現在状態を、公開previewと発行command用snapshotへ同時に変換する。 */
export async function loadCompatibilitySharePreviewData(
  {
    accountId,
    verifiedDisplayName,
    accountData,
    at,
    profileSummaryVersionId,
  }: {
    accountId: string;
    verifiedDisplayName: string | undefined;
    accountData: AccountDataNamespace | undefined;
    at: Date;
    profileSummaryVersionId?: string;
  },
  dependencies: CompatibilitySharePreviewDataDependencies = compatibilitySharePreviewDataDependencies,
): Promise<CompatibilitySharePreviewData> {
  const [source, shareProfileResult] = await Promise.all([
    dependencies.getPreviewSource(accountData, accountId, at),
    dependencies.getShareProfile(accountData, accountId, profileSummaryVersionId),
  ]);
  const shareableDiagnoses = source.answeredDiagnoses.flatMap(
    ({ id, title, answers, scoringConfig }): CompatibilitySharePreviewDiagnosis[] => {
      try {
        const scoring = dependencies.scoreAnswers(answers, scoringConfig);
        return scoring && scoringConfig
          ? [{ diagnosisId: id, title, scoringConfigId: scoringConfig.id, scoring }]
          : [];
      } catch (error) {
        logger.error(
          {
            diagnosisId: id,
            scoringConfigId: scoringConfig?.id,
            reason: error instanceof Error ? error.message : "unknown error",
          },
          "Diagnosis scoring config is invalid; omitting compatibility share theme",
        );
        return [];
      }
    },
  );
  const themes = buildCompatibilitySharePreviewThemes(shareableDiagnoses);
  const displayName = verifiedDisplayName?.trim() || null;
  const shareProfile = shareProfileResult.type === "available" ? shareProfileResult.profile : null;
  const previewToken = await dependencies.createPreviewToken(
    displayName,
    shareProfile,
    shareableDiagnoses,
  );
  const hasAnswerableDiagnosis = source.diagnoses.some(
    ({ availability, responseStatus }) => availability === "open" && responseStatus !== "answered",
  );
  const answeredDiagnosisCount = source.diagnoses.filter(
    ({ responseStatus }) => responseStatus === "answered",
  ).length;
  const hasAnsweredDiagnosis = answeredDiagnosisCount > 0;
  const hasUnshareableAnsweredDiagnosis = themes.length < answeredDiagnosisCount;
  const blockingReasons: CompatibilitySharePreviewBlockingReason[] = [];
  if (displayName === null) blockingReasons.push("display_name_unavailable");
  if (shareProfileResult.type === "unavailable") {
    blockingReasons.push("profile_summary_required");
  }
  if (shareProfileResult.type === "stale") blockingReasons.push("profile_summary_stale");
  if (themes.length === 0) {
    if (hasAnswerableDiagnosis) blockingReasons.push("diagnosis_required");
    if (!hasAnswerableDiagnosis && !hasAnsweredDiagnosis) {
      blockingReasons.push("diagnosis_unavailable");
    }
  }
  if (hasUnshareableAnsweredDiagnosis) blockingReasons.push("scoring_unavailable");

  return {
    displayName,
    shareProfile,
    shareableDiagnoses,
    preview: {
      displayName,
      previewToken,
      aboutMe: shareProfile
        ? {
            profileSummaryVersionId: shareProfile.profileSummaryVersionId,
            generatedAt: shareProfile.generatedAt,
            statements: shareProfile.statements,
          }
        : null,
      themes,
      canIssueInvitation: blockingReasons.length === 0,
      blockingReasons,
      nextAction:
        shareProfileResult.type !== "available"
          ? "profile-summary"
          : themes.length === 0 && hasAnswerableDiagnosis
            ? "diagnosis"
            : null,
    },
  };
}

/** 本人の完了済み診断を、招待発行前に確認できる安全な表示へ変換する。 */
export async function getCompatibilitySharePreview(
  { idToken, lineLoginChannelId, db, accountData, at = new Date() }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<CompatibilitySharePreviewOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;

  const data = await loadCompatibilitySharePreviewData(
    {
      accountId: session.session.accountId,
      verifiedDisplayName: session.session.displayName,
      accountData,
      at,
    },
    dependencies,
  );
  return {
    type: "resolved",
    preview: { ...data.preview, avatarUrl: "/api/profile/avatar" },
  };
}
