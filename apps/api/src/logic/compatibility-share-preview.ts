import {
  type AccountDataNamespace,
  type CompatibilitySharePreviewDiagnosis,
  type CompatibilitySharePreviewTheme,
  type D1,
  type DO,
  accountDataFor,
  buildCompatibilitySharePreviewThemes,
  createCompatibilitySharePreviewToken,
} from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { scoreDiagnosisAnswers } from "./diagnosis-scoring";
import { createLiffSession } from "./liff-session";

export type CompatibilitySharePreviewOutcome =
  | {
      type: "resolved";
      preview: {
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
      };
    }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type CompatibilitySharePreviewBlockingReason =
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

type Dependencies = {
  createSession: typeof createLiffSession;
  getPreviewSource: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
    at: Date,
  ) => ReturnType<typeof DO.account.action.diagnosis.getDiagnosisAnsweredSource>;
  getShareProfile: (
    accountData: AccountDataNamespace | undefined,
    accountId: string,
  ) => ReturnType<typeof DO.account.action.profileSummary.readCompatibilityShareProfile>;
  scoreAnswers: typeof scoreDiagnosisAnswers;
  createPreviewToken: typeof createCompatibilitySharePreviewToken;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  getPreviewSource: (accountData, accountId, at) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute("diagnosis.getAnsweredSource", at);
  },
  getShareProfile: (accountData, accountId) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute(
      "profileSummary.readCompatibilityShareProfile",
    );
  },
  scoreAnswers: scoreDiagnosisAnswers,
  createPreviewToken: createCompatibilitySharePreviewToken,
};

/** 本人の完了済み診断を、招待発行前に確認できる安全な表示へ変換する。 */
export async function getCompatibilitySharePreview(
  { idToken, lineLoginChannelId, db, accountData, at = new Date() }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<CompatibilitySharePreviewOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;

  const [source, shareProfileResult] = await Promise.all([
    dependencies.getPreviewSource(accountData, session.session.accountId, at),
    dependencies.getShareProfile(accountData, session.session.accountId),
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
  const displayName = session.session.displayName?.trim() || null;
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
    type: "resolved",
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
