import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type CompatibilityRelationship,
  type CompatibilitySharePreviewTheme,
  type D1,
  compatibilityDataFor,
  compatibilityRelationshipId,
  selectCommonCompatibilityDiagnoses,
} from "@me-builder/lib";
import {
  type CompatibilityShareAboutMe,
  type CompatibilitySharePreviewData,
  loadCompatibilitySharePreviewData,
} from "./compatibility-share-preview";
import { createLiffSession } from "./liff-session";

type Person = Readonly<{
  displayName: string;
  aboutMe: CompatibilityShareAboutMe;
  themes: readonly CompatibilitySharePreviewTheme[];
}>;

export type CompatibilityRelationshipContents =
  | Readonly<{
      relationshipId: string;
      relationshipCategory: CompatibilityRelationship["relationshipCategory"];
      status: "ready";
      partner: Person;
      viewer: Person;
    }>
  | Readonly<{
      relationshipId: string;
      relationshipCategory: CompatibilityRelationship["relationshipCategory"];
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

type ResolveCompatibilityRelationshipContentsParams = Readonly<{
  canonical: CompatibilityRelationship;
  viewerAccountId: string;
  accountData: AccountDataNamespace;
  at: Date;
}>;

/** 成立中の関係と現在の共有内容から、一覧と詳細で共通の準備状態を組み立てる。 */
export async function resolveCompatibilityRelationshipContents({
  canonical,
  viewerAccountId,
  accountData,
  at,
}: ResolveCompatibilityRelationshipContentsParams): Promise<CompatibilityRelationshipContents | null> {
  const participants = participantDetails(canonical, viewerAccountId);
  if (!participants) return null;

  const [inviterData, inviteeData] = await Promise.all([
    loadCompatibilitySharePreviewData({
      accountId: participants.inviter.accountId,
      verifiedDisplayName: participants.inviter.displayName,
      accountData,
      at,
      relationshipCategory: canonical.relationshipCategory,
    }),
    loadCompatibilitySharePreviewData({
      accountId: participants.invitee.accountId,
      verifiedDisplayName: participants.invitee.displayName,
      accountData,
      at,
      relationshipCategory: canonical.relationshipCategory,
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
      relationshipId: canonical.id,
      relationshipCategory: canonical.relationshipCategory,
      status: "waiting",
      // 閲覧者がまだ回答できる診断を持つ場合だけ診断へ案内する。
      // 回答し終えている場合は相手の準備待ちであり、本人の操作では解消できない。
      nextAction: !viewerData.aboutMe
        ? "profile-summary"
        : commonDiagnosisIds.length === 0 && viewerData.hasAnswerableDiagnosis
          ? "diagnosis"
          : null,
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
    relationshipId: canonical.id,
    relationshipCategory: canonical.relationshipCategory,
    status: "ready",
    partner: participants.viewerIsInviter ? invitee : inviter,
    viewer: participants.viewerIsInviter ? inviter : invitee,
  };
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
  if (!compatibilityRelationshipId.isValid(relationshipId)) return { type: "unavailable" };
  const session = await createLiffSession({ idToken, lineLoginChannelId, db });
  if (session.type !== "resolved") return session;

  const canonical = await compatibilityDataFor(compatibilityData, relationshipId).getRelationship(
    session.session.accountId,
  );
  if (!canonical) return { type: "unavailable" };
  const relationship = await resolveCompatibilityRelationshipContents({
    canonical,
    viewerAccountId: session.session.accountId,
    accountData,
    at,
  });
  if (!relationship) return { type: "unavailable" };
  return {
    type: "resolved",
    relationship,
  };
}
