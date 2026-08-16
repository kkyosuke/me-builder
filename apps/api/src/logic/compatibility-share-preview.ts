import {
  type AccountDataNamespace,
  type CompatibilityRelationshipCategory,
  type CompatibilitySharePreviewDiagnosis,
  type CompatibilitySharePreviewTheme,
  type DO,
  accountDataFor,
  buildCompatibilitySharePreviewThemes,
} from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import type { AuthenticatedActor } from "./authentication/types";
import { scoreDiagnosisAnswers } from "./diagnosis-scoring";

export type CompatibilityShareConsentOutcome = {
  type: "resolved";
  consent: {
    displayName: string | null;
    avatarUrl: string | null;
    canShare: boolean;
    blockingReasons: readonly CompatibilityShareConsentBlockingReason[];
    nextAction: "diagnosis" | "profile-summary" | null;
  };
};

export type CompatibilityShareContentOutcome = {
  type: "resolved";
  content: {
    relationshipCategory: CompatibilityRelationshipCategory;
    aboutMe: CompatibilityShareAboutMe | null;
    themes: readonly CompatibilitySharePreviewTheme[];
    nextAction: "diagnosis" | "profile-summary" | null;
  };
};

/** 共有開始を止める理由は、相手へ表示する名前を確認できない場合だけに限る。 */
type CompatibilityShareConsentBlockingReason = "display_name_unavailable";

type Params = {
  actor: AuthenticatedActor;
  verifiedDisplayName?: string;
  accountData?: AccountDataNamespace;
  relationshipCategory?: CompatibilityRelationshipCategory;
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

type Dependencies = CompatibilitySharePreviewDataDependencies;

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
  ...compatibilitySharePreviewDataDependencies,
};

/** 認証済みAccountの現在状態を、相性シートへ開示できる共有表示へ変換する。 */
export async function loadCompatibilitySharePreviewData(
  {
    accountId,
    verifiedDisplayName,
    accountData,
    at,
    relationshipCategory,
  }: {
    accountId: string;
    verifiedDisplayName: string | undefined;
    accountData: AccountDataNamespace | undefined;
    at: Date;
    relationshipCategory?: CompatibilityRelationshipCategory;
  },
  dependencies: CompatibilitySharePreviewDataDependencies = compatibilitySharePreviewDataDependencies,
): Promise<CompatibilitySharePreviewData> {
  const [source, shareProfileResult] = await Promise.all([
    dependencies.getPreviewSource(accountData, accountId, at),
    dependencies.getShareProfile(accountData, accountId),
  ]);
  const isCategoryShareable = (category: string) =>
    category === "general" ||
    relationshipCategory === undefined ||
    category === relationshipCategory;
  const shareableDiagnoses = source.answeredDiagnoses.flatMap(
    ({
      id,
      title,
      relationshipCategory,
      answers,
      scoringConfig,
    }): CompatibilitySharePreviewDiagnosis[] => {
      if (!isCategoryShareable(relationshipCategory)) return [];
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
      isCategoryShareable(relationshipCategory) &&
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
  { actor, verifiedDisplayName, accountData, relationshipCategory, at = new Date() }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<CompatibilityShareConsentOutcome> {
  const data = await loadCompatibilitySharePreviewData(
    {
      accountId: actor.accountId,
      verifiedDisplayName,
      accountData,
      ...(relationshipCategory ? { relationshipCategory } : {}),
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

/** 本人が「わたし」で確認する、選択カテゴリの現在の共有表示だけを返す。 */
export async function getCompatibilityShareContent(
  {
    actor,
    verifiedDisplayName,
    accountData,
    relationshipCategory,
    at = new Date(),
  }: Params & { relationshipCategory: CompatibilityRelationshipCategory },
  dependencies: Dependencies = defaultDependencies,
): Promise<CompatibilityShareContentOutcome> {
  const data = await loadCompatibilitySharePreviewData(
    {
      accountId: actor.accountId,
      verifiedDisplayName,
      accountData,
      relationshipCategory,
      at,
    },
    dependencies,
  );

  return {
    type: "resolved",
    content: {
      relationshipCategory,
      aboutMe: data.aboutMe,
      themes: data.themes,
      nextAction: data.nextAction,
    },
  };
}
