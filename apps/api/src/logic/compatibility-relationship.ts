import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type CompatibilityRelationship,
  type CompatibilitySharePreviewTheme,
  type D1,
  compatibilityDataFor,
  selectCommonCompatibilityDiagnoses,
} from "@me-builder/lib";
import {
  type CompatibilityShareAboutMe,
  type CompatibilitySharePreviewData,
  loadCompatibilitySharePreviewData,
} from "./compatibility-share-preview";
import { createLiffSession } from "./liff-session";

const RELATIONSHIP_ID_PATTERN = /^[a-f0-9]{64}$/;

type Person = Readonly<{
  displayName: string;
  aboutMe: CompatibilityShareAboutMe;
  themes: readonly CompatibilitySharePreviewTheme[];
}>;

type CompatibilityRelationshipContents =
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

function participantDetails(relationship: CompatibilityRelationship, viewerAccountId: string) {
  const inviteeAccountId = relationship.inviteeAccountId;
  const inviteeDisplayName = relationship.inviteeDisplayName;
  if (!inviteeAccountId || !inviteeDisplayName) return null;
  return {
    viewerIsInviter: relationship.inviterAccountId === viewerAccountId,
    inviter: {
      accountId: relationship.inviterAccountId,
      displayName: relationship.inviterDisplayName,
    },
    invitee: { accountId: inviteeAccountId, displayName: inviteeDisplayName },
  };
}

function orderedThemes(
  data: CompatibilitySharePreviewData,
  diagnosisIds: readonly string[],
): CompatibilitySharePreviewTheme[] {
  const byId = new Map(data.themes.map((theme) => [theme.diagnosisId, theme]));
  return diagnosisIds.flatMap((diagnosisId) => {
    const theme = byId.get(diagnosisId);
    return theme ? [theme] : [];
  });
}

/**
 * 成立中の関係について、双方の現在の共有内容から相性シートを組み立てる。
 * 共有は関係が続く限り自動で最新化されるため、過去の同意内容と照合しない。
 */
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

  const [inviterData, inviteeData] = await Promise.all([
    loadCompatibilitySharePreviewData({
      accountId: participants.inviter.accountId,
      verifiedDisplayName: participants.inviter.displayName,
      accountData,
      at,
    }),
    loadCompatibilitySharePreviewData({
      accountId: participants.invitee.accountId,
      verifiedDisplayName: participants.invitee.displayName,
      accountData,
      at,
    }),
  ]);
  const viewerData = participants.viewerIsInviter ? inviterData : inviteeData;
  const commonDiagnosisIds = selectCommonCompatibilityDiagnoses(
    inviterData.themes,
    inviteeData.themes,
  );
  const inviterAboutMe = inviterData.aboutMe;
  const inviteeAboutMe = inviteeData.aboutMe;

  if (!inviterAboutMe || !inviteeAboutMe || commonDiagnosisIds.length === 0) {
    return {
      type: "resolved",
      relationship: {
        relationshipId,
        status: "waiting",
        nextAction: !viewerData.aboutMe
          ? "profile-summary"
          : commonDiagnosisIds.length === 0
            ? "diagnosis"
            : null,
      },
    };
  }

  const inviter = {
    displayName: participants.inviter.displayName,
    aboutMe: inviterAboutMe,
    themes: orderedThemes(inviterData, commonDiagnosisIds),
  };
  const invitee = {
    displayName: participants.invitee.displayName,
    aboutMe: inviteeAboutMe,
    themes: orderedThemes(inviteeData, commonDiagnosisIds),
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
