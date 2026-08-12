import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type CompatibilityProfileFingerprint,
  type CompatibilityRelationship,
  type CompatibilitySharePreviewTheme,
  type CompatibilityThemeFingerprint,
  type D1,
  compatibilityDataFor,
  createCompatibilityShareThemeFingerprints,
} from "@me-builder/lib";
import {
  type CompatibilitySharePreviewData,
  loadCompatibilitySharePreviewData,
} from "./compatibility-share-preview";
import { createLiffSession } from "./liff-session";

const RELATIONSHIP_ID_PATTERN = /^[a-f0-9]{64}$/;

type Person = Readonly<{
  displayName: string;
  aboutMe: NonNullable<CompatibilitySharePreviewData["preview"]["aboutMe"]>;
  themes: readonly CompatibilitySharePreviewTheme[];
}>;

export type CompatibilityRelationshipContents =
  | Readonly<{
      relationshipId: string;
      status: "ready";
      partner: Person;
      viewer: Person;
    }>
  | Readonly<{
      relationshipId: string;
      status: "waiting";
      nextAction: "diagnosis" | "profile-summary" | null;
    }>;

export type CompatibilityRelationshipOutcome =
  | { type: "resolved"; relationship: CompatibilityRelationshipContents }
  | { type: "unavailable" }
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

function matchesProfile(
  data: CompatibilitySharePreviewData,
  consent: CompatibilityProfileFingerprint | null,
): boolean {
  return Boolean(
    consent &&
      data.shareProfile &&
      data.shareProfile.profileSummaryVersionId === consent.profileSummaryVersionId &&
      data.shareProfile.fingerprint === consent.fingerprint,
  );
}

function matchesThemes(
  actual: readonly CompatibilityThemeFingerprint[],
  consent: readonly CompatibilityThemeFingerprint[],
): boolean {
  if (actual.length !== consent.length) return false;
  const actualById = new Map(actual.map((theme) => [theme.diagnosisId, theme.resultFingerprint]));
  return consent.every((theme) => actualById.get(theme.diagnosisId) === theme.resultFingerprint);
}

function commonDiagnoses(
  data: CompatibilitySharePreviewData,
  acceptedDiagnosisIds: ReadonlySet<string>,
) {
  return data.shareableDiagnoses.filter(({ diagnosisId }) => acceptedDiagnosisIds.has(diagnosisId));
}

function orderedThemes(
  data: CompatibilitySharePreviewData,
  acceptedDiagnosisIds: readonly string[],
): CompatibilitySharePreviewTheme[] {
  const byId = new Map(data.preview.themes.map((theme) => [theme.diagnosisId, theme]));
  return acceptedDiagnosisIds.flatMap((diagnosisId) => {
    const theme = byId.get(diagnosisId);
    return theme ? [theme] : [];
  });
}

function participantDetails(relationship: CompatibilityRelationship, viewerAccountId: string) {
  const viewerIsInviter = relationship.inviterAccountId === viewerAccountId;
  const inviteeAccountId = relationship.inviteeAccountId;
  const inviteeDisplayName = relationship.inviteeDisplayName;
  if (
    !inviteeAccountId ||
    !inviteeDisplayName ||
    !relationship.offeredProfile ||
    !relationship.acceptedProfile
  ) {
    return null;
  }
  return {
    viewerIsInviter,
    inviter: {
      accountId: relationship.inviterAccountId,
      displayName: relationship.inviterDisplayName,
      profile: relationship.offeredProfile,
      themes: relationship.offeredThemes,
    },
    invitee: {
      accountId: inviteeAccountId,
      displayName: inviteeDisplayName,
      profile: relationship.acceptedProfile,
      themes: relationship.acceptedThemes,
    },
  };
}

/** accepted正本の同意指紋を現在のAccountData表示へ照合し、相性シートを再構築する。 */
export async function getCompatibilityRelationshipContents({
  relationshipId,
  idToken,
  lineLoginChannelId,
  db,
  accountData,
  compatibilityData,
  at = new Date(),
}: Params): Promise<CompatibilityRelationshipOutcome> {
  const session = await createLiffSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;
  if (!RELATIONSHIP_ID_PATTERN.test(relationshipId)) return { type: "unavailable" };

  const canonical = await compatibilityDataFor(compatibilityData, relationshipId).getRelationship(
    session.session.accountId,
  );
  if (!canonical) return { type: "unavailable" };
  const participants = participantDetails(canonical, session.session.accountId);
  if (!participants) return { type: "unavailable" };

  const acceptedDiagnosisIds = canonical.acceptedThemes.map(({ diagnosisId }) => diagnosisId);
  const acceptedDiagnosisIdSet = new Set(acceptedDiagnosisIds);
  const [inviterData, inviteeData] = await Promise.all([
    loadCompatibilitySharePreviewData({
      accountId: participants.inviter.accountId,
      verifiedDisplayName: participants.inviter.displayName,
      accountData,
      at,
      profileSummaryVersionId: participants.inviter.profile?.profileSummaryVersionId,
    }),
    loadCompatibilitySharePreviewData({
      accountId: participants.invitee.accountId,
      verifiedDisplayName: participants.invitee.displayName,
      accountData,
      at,
      profileSummaryVersionId: participants.invitee.profile.profileSummaryVersionId,
    }),
  ]);
  const inviterDiagnoses = commonDiagnoses(inviterData, acceptedDiagnosisIdSet);
  const inviteeDiagnoses = commonDiagnoses(inviteeData, acceptedDiagnosisIdSet);
  const [inviterFingerprints, inviteeFingerprints] = await Promise.all([
    createCompatibilityShareThemeFingerprints(inviterDiagnoses),
    createCompatibilityShareThemeFingerprints(inviteeDiagnoses),
  ]);
  const offeredCommonThemes = canonical.offeredThemes.filter(({ diagnosisId }) =>
    acceptedDiagnosisIdSet.has(diagnosisId),
  );
  const inviterProfileReady = matchesProfile(inviterData, participants.inviter.profile);
  const inviteeProfileReady = matchesProfile(inviteeData, participants.invitee.profile);
  const inviterThemesReady = matchesThemes(inviterFingerprints, offeredCommonThemes);
  const inviteeThemesReady = matchesThemes(inviteeFingerprints, canonical.acceptedThemes);

  if (!inviterProfileReady || !inviteeProfileReady || !inviterThemesReady || !inviteeThemesReady) {
    const ownProfileReady = participants.viewerIsInviter
      ? inviterProfileReady
      : inviteeProfileReady;
    const ownThemesReady = participants.viewerIsInviter ? inviterThemesReady : inviteeThemesReady;
    return {
      type: "resolved",
      relationship: {
        relationshipId,
        status: "waiting",
        nextAction: !ownProfileReady ? "profile-summary" : !ownThemesReady ? "diagnosis" : null,
      },
    };
  }

  const inviterAboutMe = inviterData.preview.aboutMe;
  const inviteeAboutMe = inviteeData.preview.aboutMe;
  if (!inviterAboutMe || !inviteeAboutMe) return { type: "unavailable" };
  const inviter = {
    displayName: participants.inviter.displayName,
    aboutMe: inviterAboutMe,
    themes: orderedThemes(inviterData, acceptedDiagnosisIds),
  };
  const invitee = {
    displayName: participants.invitee.displayName,
    aboutMe: inviteeAboutMe,
    themes: orderedThemes(inviteeData, acceptedDiagnosisIds),
  };
  return {
    type: "resolved",
    relationship: {
      relationshipId,
      status: "ready",
      partner: participants.viewerIsInviter ? invitee : inviter,
      viewer: participants.viewerIsInviter ? inviter : invitee,
    },
  };
}
