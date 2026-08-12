import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type CompatibilityInvitationAcceptanceContext,
  type CompatibilityInvitationPreview,
  type CompatibilitySharePreviewTheme,
  type D1,
  compatibilityDataFor,
  createCompatibilityShareThemeFingerprints,
} from "@me-builder/lib";
import {
  type CompatibilitySharePreviewBlockingReason,
  type CompatibilitySharePreviewData,
  loadCompatibilitySharePreviewData,
} from "./compatibility-share-preview";
import { createLiffSession } from "./liff-session";

const RELATIONSHIP_ID_PATTERN = /^[a-f0-9]{64}$/;

type CompatibilityInvitationPreviewBlockingReason =
  | CompatibilitySharePreviewBlockingReason
  | "common_diagnosis_required";

type PublicProfile = NonNullable<CompatibilitySharePreviewData["preview"]["aboutMe"]>;

type CompatibilityInvitationContents = Readonly<{
  inviter: Readonly<{
    displayName: string;
    aboutMe: PublicProfile;
    themes: readonly CompatibilitySharePreviewTheme[];
  }>;
  recipient: Readonly<{
    displayName: string | null;
    previewToken: string;
    aboutMe: PublicProfile | null;
    themes: readonly CompatibilitySharePreviewTheme[];
  }>;
  expiresAt: string;
  canAccept: boolean;
  blockingReasons: readonly CompatibilityInvitationPreviewBlockingReason[];
  nextAction: "diagnosis" | "profile-summary" | null;
}>;

type CompatibilityInvitationPreviewOutcome =
  | { type: "resolved"; invitation: CompatibilityInvitationContents }
  | { type: "unavailable" }
  | { type: "own-invitation" }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

type Params = Readonly<{
  relationshipId: string;
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  accountData: AccountDataNamespace;
  compatibilityData: CompatibilityDataNamespace;
  at?: Date;
}>;

type Dependencies = Readonly<{
  createSession: typeof createLiffSession;
  getInvitationPreview: (
    namespace: CompatibilityDataNamespace,
    relationshipId: string,
    viewerAccountId: string,
  ) => Promise<CompatibilityInvitationPreview | null>;
  getInvitationContext: (
    namespace: CompatibilityDataNamespace,
    relationshipId: string,
  ) => Promise<CompatibilityInvitationAcceptanceContext | null>;
  loadSharePreviewData: typeof loadCompatibilitySharePreviewData;
  createThemeFingerprints: typeof createCompatibilityShareThemeFingerprints;
}>;

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  getInvitationPreview: (namespace, relationshipId, viewerAccountId) =>
    compatibilityDataFor(namespace, relationshipId).getInvitationPreview(viewerAccountId),
  getInvitationContext: (namespace, relationshipId) =>
    compatibilityDataFor(namespace, relationshipId).getInvitationAcceptanceContext(),
  loadSharePreviewData: loadCompatibilitySharePreviewData,
  createThemeFingerprints: createCompatibilityShareThemeFingerprints,
};

function matchesOfferedSnapshot(
  context: CompatibilityInvitationAcceptanceContext,
  data: CompatibilitySharePreviewData,
  fingerprints: readonly { diagnosisId: string; resultFingerprint: string }[],
): boolean {
  if (
    !data.shareProfile ||
    data.shareProfile.profileSummaryVersionId !== context.offeredProfile.profileSummaryVersionId ||
    data.shareProfile.fingerprint !== context.offeredProfile.fingerprint
  ) {
    return false;
  }
  if (fingerprints.length !== context.offeredThemes.length) return false;
  const actual = new Map(fingerprints.map((theme) => [theme.diagnosisId, theme.resultFingerprint]));
  return context.offeredThemes.every(
    (theme) => actual.get(theme.diagnosisId) === theme.resultFingerprint,
  );
}

/** pending招待と双方の現在状態から、保存を伴わない受信者向け確認表示を組み立てる。 */
export async function getCompatibilityInvitationContents(
  {
    relationshipId,
    idToken,
    lineLoginChannelId,
    db,
    accountData,
    compatibilityData,
    at = new Date(),
  }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<CompatibilityInvitationPreviewOutcome> {
  const session = await dependencies.createSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;
  if (!RELATIONSHIP_ID_PATTERN.test(relationshipId)) return { type: "unavailable" };

  const preview = await dependencies.getInvitationPreview(
    compatibilityData,
    relationshipId,
    session.session.accountId,
  );
  if (!preview) return { type: "unavailable" };
  if (preview.isOwnInvitation) return { type: "own-invitation" };

  const context = await dependencies.getInvitationContext(compatibilityData, relationshipId);
  if (!context || !context.offeredProfile || !Array.isArray(context.offeredThemes)) {
    return { type: "unavailable" };
  }

  const offeredDiagnosisIds = new Set(context.offeredDiagnosisIds);
  const [inviterData, recipientData] = await Promise.all([
    dependencies.loadSharePreviewData({
      accountId: context.inviterAccountId,
      verifiedDisplayName: preview.inviterDisplayName,
      accountData,
      at,
      profileSummaryVersionId: context.offeredProfile.profileSummaryVersionId,
    }),
    dependencies.loadSharePreviewData({
      accountId: session.session.accountId,
      verifiedDisplayName: session.session.displayName,
      accountData,
      at,
    }),
  ]);
  const offeredDiagnoses = inviterData.shareableDiagnoses.filter(({ diagnosisId }) =>
    offeredDiagnosisIds.has(diagnosisId),
  );
  const offeredFingerprints = await dependencies.createThemeFingerprints(offeredDiagnoses);
  if (!matchesOfferedSnapshot(context, inviterData, offeredFingerprints)) {
    return { type: "unavailable" };
  }

  const inviterThemesById = new Map(
    inviterData.preview.themes.map((theme) => [theme.diagnosisId, theme]),
  );
  const inviterThemes = context.offeredDiagnosisIds.flatMap((diagnosisId) => {
    const theme = inviterThemesById.get(diagnosisId);
    return theme ? [theme] : [];
  });
  const recipientThemesById = new Map(
    recipientData.preview.themes.map((theme) => [theme.diagnosisId, theme]),
  );
  const recipientThemes = context.offeredDiagnosisIds.flatMap((diagnosisId) => {
    const theme = recipientThemesById.get(diagnosisId);
    return theme ? [theme] : [];
  });
  const blockingReasons: CompatibilityInvitationPreviewBlockingReason[] = [
    ...recipientData.preview.blockingReasons,
  ];
  if (recipientThemes.length === 0) blockingReasons.push("common_diagnosis_required");

  const aboutMe = inviterData.preview.aboutMe;
  if (!aboutMe) return { type: "unavailable" };

  return {
    type: "resolved",
    invitation: {
      inviter: {
        displayName: preview.inviterDisplayName,
        aboutMe,
        themes: inviterThemes,
      },
      recipient: {
        displayName: recipientData.preview.displayName,
        previewToken: recipientData.preview.previewToken,
        aboutMe: recipientData.preview.aboutMe,
        themes: recipientThemes,
      },
      expiresAt: preview.expiresAt.toISOString(),
      canAccept: blockingReasons.length === 0,
      blockingReasons,
      nextAction:
        recipientData.preview.nextAction === "profile-summary"
          ? "profile-summary"
          : recipientThemes.length === 0
            ? "diagnosis"
            : recipientData.preview.nextAction,
    },
  };
}
