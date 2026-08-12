import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type D1,
  createCompatibilityInvitationWithReference,
  createCompatibilityShareThemeFingerprints,
} from "@me-builder/lib";
import {
  type CompatibilitySharePreviewDataDependencies,
  compatibilitySharePreviewDataDependencies,
  loadCompatibilitySharePreviewData,
} from "./compatibility-share-preview";
import { createLiffSession } from "./liff-session";

export type CompatibilityInvitationIssueOutcome =
  | Readonly<{ type: "created"; invitationUrl: string; expiresAt: string }>
  | Readonly<{ type: "preview-changed" }>
  | Readonly<{ type: "share-unavailable" }>
  | Readonly<{ type: "not-configured" }>
  | Readonly<{ type: "unauthenticated"; reason: string }>
  | Readonly<{ type: "account-not-found" }>;

type Params = Readonly<{
  idToken: string | undefined;
  previewToken: string;
  lineLoginChannelId: string | undefined;
  liffId: string;
  db: D1.shared.Client;
  accountData: AccountDataNamespace;
  compatibilityData: CompatibilityDataNamespace;
  at?: Date;
}>;

type Dependencies = CompatibilitySharePreviewDataDependencies &
  Readonly<{
    createSession: typeof createLiffSession;
    createThemeFingerprints: typeof createCompatibilityShareThemeFingerprints;
    createInvitation: typeof createCompatibilityInvitationWithReference;
  }>;

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  ...compatibilitySharePreviewDataDependencies,
  createThemeFingerprints: createCompatibilityShareThemeFingerprints,
  createInvitation: createCompatibilityInvitationWithReference,
};

/** 確認済みpreviewが現在状態と一致する場合だけ、1人用の招待を発行する。 */
export async function issueCompatibilityInvitation(
  {
    idToken,
    previewToken,
    lineLoginChannelId,
    liffId,
    db,
    accountData,
    compatibilityData,
    at = new Date(),
  }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<CompatibilityInvitationIssueOutcome> {
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
  if (data.preview.previewToken !== previewToken) return { type: "preview-changed" };
  if (!data.preview.canIssueInvitation || !data.displayName || !data.shareProfile) {
    return { type: "share-unavailable" };
  }

  const offeredThemes = await dependencies.createThemeFingerprints(data.shareableDiagnoses);
  const result = await dependencies.createInvitation(accountData, compatibilityData, {
    inviterAccountId: session.session.accountId,
    inviterDisplayName: data.displayName,
    offeredProfile: {
      profileSummaryVersionId: data.shareProfile.profileSummaryVersionId,
      fingerprint: data.shareProfile.fingerprint,
    },
    offeredThemes,
  });
  const invitationUrl = new URL(
    `https://liff.line.me/${encodeURIComponent(liffId)}/compatibility/invitations/${result.relationship.id}`,
  ).toString();
  return {
    type: "created",
    invitationUrl,
    expiresAt: result.relationship.expiresAt.toISOString(),
  };
}
