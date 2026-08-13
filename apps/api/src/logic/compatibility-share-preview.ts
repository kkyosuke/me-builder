import {
  type AccountDataNamespace,
  type CompatibilitySharePreviewDiagnosis,
  type CompatibilitySharePreviewTheme,
  type D1,
  type DO,
  accountDataFor,
  buildCompatibilitySharePreviewThemes,
} from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { scoreDiagnosisAnswers } from "./diagnosis-scoring";
import { createLiffSession } from "./liff-session";

export type CompatibilityShareConsentOutcome =
  | {
      type: "resolved";
      consent: {
        displayName: string | null;
        avatarUrl: string | null;
        canShare: boolean;
        blockingReasons: readonly CompatibilityShareConsentBlockingReason[];
        nextAction: "diagnosis" | "profile-summary" | null;
      };
    }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

/** 共有開始を止める理由は、相手へ表示する名前を確認できない場合だけに限る。 */
type CompatibilityShareConsentBlockingReason = "display_name_unavailable";

type Params = {
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData?: AccountDataNamespace;
  at?: Date;
};

/** 相手へ開示できる「私について」。内部の指紋や根拠参照を含めない。 */
export type CompatibilityShareAboutMe = Readonly<{
  profileSummaryVersionId: string;
  generatedAt: string;
  statements: readonly { key: string; label: string; statement: string }[];
}>;

export type CompatibilitySharePreviewData = Readonly<{
  displayName: string | null;
  aboutMe: CompatibilityShareAboutMe | null;
  themes: readonly CompatibilitySharePreviewTheme[];
  /** 本人がいま回答できる未完了Diagnosisがあるか。案内の出し分けだけに使う。 */
  hasAnswerableDiagnosis: boolean;
  /** 共有できる内容がまだない本人へ案内する次の操作。共有開始は妨げない。 */
  nextAction: "diagnosis" | "profile-summary" | null;
}>;

type CompatibilitySharePreviewDataDependencies = {
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
};

type Dependencies = CompatibilitySharePreviewDataDependencies & {
  createSession: typeof createLiffSession;
};

const compatibilitySharePreviewDataDependencies: CompatibilitySharePreviewDataDependencies = {
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
};

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  ...compatibilitySharePreviewDataDependencies,
};

/** 認証済みAccountの現在状態を、相性シートへ開示できる共有表示へ変換する。 */
export async function loadCompatibilitySharePreviewData(
  {
    accountId,
    verifiedDisplayName,
    accountData,
    at,
  }: {
    accountId: string;
    verifiedDisplayName: string | undefined;
    accountData: AccountDataNamespace | undefined;
    at: Date;
  },
  dependencies: CompatibilitySharePreviewDataDependencies = compatibilitySharePreviewDataDependencies,
): Promise<CompatibilitySharePreviewData> {
  const [source, shareProfileResult] = await Promise.all([
    dependencies.getPreviewSource(accountData, accountId, at),
    dependencies.getShareProfile(accountData, accountId),
  ]);
  // 招待へ関係カテゴリを保存するまでは、特定の関係を前提にしない診断だけを共有する。
  // 関係カテゴリ対応後は「招待カテゴリと一致する診断 + general」へ広げる。
  const shareableDiagnoses = source.answeredDiagnoses.flatMap(
    ({
      id,
      title,
      relationshipCategory,
      answers,
      scoringConfig,
    }): CompatibilitySharePreviewDiagnosis[] => {
      if (relationshipCategory !== "general") return [];
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
  const shareProfile = shareProfileResult.type === "available" ? shareProfileResult.profile : null;
  const hasAnswerableDiagnosis = source.diagnoses.some(
    ({ relationshipCategory, availability, responseStatus }) =>
      relationshipCategory === "general" &&
      availability === "open" &&
      responseStatus !== "answered",
  );

  return {
    displayName: verifiedDisplayName?.trim() || null,
    aboutMe: shareProfile
      ? {
          profileSummaryVersionId: shareProfile.profileSummaryVersionId,
          generatedAt: shareProfile.generatedAt,
          statements: shareProfile.statements,
        }
      : null,
    themes,
    hasAnswerableDiagnosis,
    nextAction: !shareProfile
      ? "profile-summary"
      : themes.length === 0 && hasAnswerableDiagnosis
        ? "diagnosis"
        : null,
  };
}

/** 本人が招待リンクを発行する前に確認する、共有可否だけを返す。 */
export async function getCompatibilityShareConsent(
  { idToken, lineLoginChannelId, db, accountData, at = new Date() }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<CompatibilityShareConsentOutcome> {
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
  const blockingReasons: CompatibilityShareConsentBlockingReason[] =
    data.displayName === null ? ["display_name_unavailable"] : [];
  return {
    type: "resolved",
    consent: {
      displayName: data.displayName,
      avatarUrl: "/api/profile/avatar",
      canShare: blockingReasons.length === 0,
      blockingReasons,
      nextAction: data.nextAction,
    },
  };
}
