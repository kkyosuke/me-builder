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
        themes: readonly CompatibilitySharePreviewTheme[];
        canIssueInvitation: boolean;
        blockingReasons: readonly CompatibilitySharePreviewBlockingReason[];
        nextAction: "diagnosis" | null;
      };
    }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type CompatibilitySharePreviewBlockingReason =
  | "display_name_unavailable"
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
  ) => ReturnType<typeof DO.account.action.diagnosis.getCompatibilitySharePreviewSource>;
  scoreAnswers: typeof scoreDiagnosisAnswers;
  createPreviewToken: typeof createCompatibilitySharePreviewToken;
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  getPreviewSource: (accountData, accountId, at) => {
    if (!accountData) throw new Error("ACCOUNT_DATA binding is not configured");
    return accountDataFor(accountData, accountId).execute(
      "diagnosis.getCompatibilitySharePreviewSource",
      at,
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

  const source = await dependencies.getPreviewSource(accountData, session.session.accountId, at);
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
  const previewToken = await dependencies.createPreviewToken(displayName, shareableDiagnoses);
  const hasAnswerableDiagnosis = source.diagnoses.some(
    ({ availability, responseStatus }) => availability === "open" && responseStatus !== "answered",
  );
  const hasAnsweredDiagnosis = source.diagnoses.some(
    ({ responseStatus }) => responseStatus === "answered",
  );
  const blockingReasons: CompatibilitySharePreviewBlockingReason[] = [];
  if (displayName === null) blockingReasons.push("display_name_unavailable");
  if (themes.length === 0) {
    if (hasAnswerableDiagnosis) blockingReasons.push("diagnosis_required");
    if (hasAnsweredDiagnosis) blockingReasons.push("scoring_unavailable");
    if (!hasAnswerableDiagnosis && !hasAnsweredDiagnosis) {
      blockingReasons.push("diagnosis_unavailable");
    }
  }

  return {
    type: "resolved",
    preview: {
      displayName,
      previewToken,
      themes,
      canIssueInvitation: blockingReasons.length === 0,
      blockingReasons,
      nextAction: themes.length === 0 && hasAnswerableDiagnosis ? "diagnosis" : null,
    },
  };
}
