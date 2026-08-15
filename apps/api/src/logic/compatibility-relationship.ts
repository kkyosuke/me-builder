import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type CompatibilityPairProgression,
  type CompatibilityPairThemeFingerprint,
  type CompatibilityRelationship,
  type CompatibilitySharePreviewTheme,
  type D1,
  accountDataFor,
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

type UnavailableTheme = Readonly<{
  diagnosisId: string;
  title: string;
}>;

type CompatibilityReadyContents = Readonly<{
  relationshipId: string;
  relationshipCategory: CompatibilityRelationship["relationshipCategory"];
  status: "ready";
  partner: Person;
  viewer: Person;
  unavailableThemes: readonly UnavailableTheme[];
}>;

type CompatibilityResolvedContents =
  | CompatibilityReadyContents
  | Readonly<{
      relationshipId: string;
      relationshipCategory: CompatibilityRelationship["relationshipCategory"];
      status: "waiting";
      nextAction: "diagnosis" | "profile-summary" | null;
    }>;

type CompatibilityRelationshipContents =
  | Readonly<CompatibilityReadyContents & { progression: CompatibilityPairProgression | null }>
  | Exclude<CompatibilityResolvedContents, CompatibilityReadyContents>;

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

/** 双方の共通部分に含まれない診断を、回答者を明かさず一度だけ返す。 */
function unavailableThemes(
  primary: readonly CompatibilitySharePreviewTheme[],
  secondary: readonly CompatibilitySharePreviewTheme[],
  commonDiagnosisIds: readonly string[],
): UnavailableTheme[] {
  const commonIds = new Set(commonDiagnosisIds);
  const themes = new Map<string, string>();
  for (const theme of [...primary, ...secondary]) {
    if (!commonIds.has(theme.diagnosisId) && !themes.has(theme.diagnosisId)) {
      themes.set(theme.diagnosisId, theme.title);
    }
  }
  return [...themes].map(([diagnosisId, title]) => ({ diagnosisId, title }));
}

type ResolveCompatibilityRelationshipContentsParams = Readonly<{
  canonical: CompatibilityRelationship;
  viewerAccountId: string;
  accountData: AccountDataNamespace;
  at: Date;
}>;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pairThemeFingerprints(
  relationship: CompatibilityReadyContents,
): Promise<CompatibilityPairThemeFingerprint[]> {
  const partnerThemes = new Map(
    relationship.partner.themes.map((theme) => [theme.diagnosisId, theme] as const),
  );
  return Promise.all(
    relationship.viewer.themes.flatMap((viewerTheme) => {
      const partnerTheme = partnerThemes.get(viewerTheme.diagnosisId);
      if (!partnerTheme) return [];
      const serialize = (theme: CompatibilitySharePreviewTheme) =>
        JSON.stringify(
          [...theme.parameters]
            .sort((left, right) => left.id.localeCompare(right.id))
            .map(({ id, label, lowLabel, highLabel, position }) => ({
              id,
              label,
              lowLabel,
              highLabel,
              position,
            })),
        );
      const sides = [serialize(viewerTheme), serialize(partnerTheme)].sort();
      return [
        sha256(JSON.stringify([viewerTheme.diagnosisId, ...sides])).then((fingerprint) => ({
          diagnosisId: viewerTheme.diagnosisId,
          fingerprint,
        })),
      ];
    }),
  );
}

async function restorePairProgressionIfNeeded(
  canonical: CompatibilityRelationship,
  actorAccountId: string,
  accountData: AccountDataNamespace,
  compatibilityData: CompatibilityDataNamespace,
): Promise<void> {
  const current = compatibilityDataFor(compatibilityData, canonical.id);
  if (await current.hasProgressionState(actorAccountId)) return;
  const participants = participantDetails(canonical, actorAccountId);
  if (!participants) return;
  const partnerAccountId = participants.viewerIsInviter
    ? participants.invitee.accountId
    : participants.inviter.accountId;
  const history = await accountDataFor(accountData, actorAccountId).execute(
    "compatibility.listProgressionHistoryReferences",
    {
      partnerAccountId,
      relationshipCategory: canonical.relationshipCategory,
    },
  );
  for (const reference of history) {
    if (reference.relationshipId === canonical.id) continue;
    const snapshot = await compatibilityDataFor(
      compatibilityData,
      reference.relationshipId,
    ).getProgressionResumeSnapshot(actorAccountId);
    if (!snapshot || snapshot.relationshipCategory !== canonical.relationshipCategory) continue;
    await current.restoreProgression(actorAccountId, snapshot);
    return;
  }
}

/** 成立中の関係と現在の共有内容から、一覧と詳細で共通の準備状態を組み立てる。 */
export async function resolveCompatibilityRelationshipContents({
  canonical,
  viewerAccountId,
  accountData,
  at,
}: ResolveCompatibilityRelationshipContentsParams): Promise<CompatibilityResolvedContents | null> {
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
      // 回答済み・相手の準備待ち・採点設定版の不一致など、本人の操作で
      // 解消できない場合は理由を断定せず案内を出さない。
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
    unavailableThemes: unavailableThemes(
      inviterData.themes,
      inviteeData.themes,
      commonDiagnosisIds,
    ),
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

  const relationshipData = compatibilityDataFor(compatibilityData, relationshipId);
  const canonical = await relationshipData.getRelationship(session.session.accountId);
  if (!canonical) return { type: "unavailable" };
  const relationship = await resolveCompatibilityRelationshipContents({
    canonical,
    viewerAccountId: session.session.accountId,
    accountData,
    at,
  });
  if (!relationship) return { type: "unavailable" };
  if (relationship.status === "ready") {
    try {
      await restorePairProgressionIfNeeded(
        canonical,
        session.session.accountId,
        accountData,
        compatibilityData,
      );
      const progression = await relationshipData.synchronizeProgression(
        session.session.accountId,
        await pairThemeFingerprints(relationship),
      );
      if (!progression) return { type: "unavailable" };
      return {
        type: "resolved",
        relationship: { ...relationship, progression },
      };
    } catch {
      return {
        type: "resolved",
        relationship: { ...relationship, progression: null },
      };
    }
  }
  return {
    type: "resolved",
    relationship,
  };
}
