import {
  type AccountDataNamespace,
  type CompatibilityDataNamespace,
  type CompatibilityRelationshipCategory,
  type ConfiguredLiff,
  type D1,
  createCompatibilityInvitationWithReference,
} from "@me-builder/lib";
import { createCompatibilityInvitationUrl } from "./compatibility-invitation-url";
import { createLiffSession } from "./liff-session";

export type CompatibilityInvitationIssueOutcome =
  | Readonly<{
      type: "created";
      invitationUrl: string;
      expiresAt: string;
      relationshipCategory: CompatibilityRelationshipCategory;
    }>
  | Readonly<{ type: "share-unavailable" }>
  | Readonly<{ type: "not-configured" }>
  | Readonly<{ type: "unauthenticated"; reason: string }>
  | Readonly<{ type: "account-not-found" }>;

type Params = Readonly<{
  idToken: string | undefined;
  liff: ConfiguredLiff;
  db: D1.shared.Client;
  accountData: AccountDataNamespace;
  compatibilityData: CompatibilityDataNamespace;
  relationshipCategory: CompatibilityRelationshipCategory;
}>;

type Dependencies = Readonly<{
  createSession: typeof createLiffSession;
  createInvitation: typeof createCompatibilityInvitationWithReference;
}>;

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  createInvitation: createCompatibilityInvitationWithReference,
};

/** 本人が共有へ同意した時点の表示名だけを固定し、1人用の招待を発行する。 */
export async function issueCompatibilityInvitation(
  { idToken, liff, db, accountData, compatibilityData, relationshipCategory }: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<CompatibilityInvitationIssueOutcome> {
  const session = await dependencies.createSession({
    idToken,
    lineLoginChannelId: liff.lineLoginChannelId,
    db,
  });
  if (session.type !== "resolved") return session;

  // 共有対象は関係の成立後に自動で最新化されるため、発行時に固定するのは表示名だけ。
  const inviterDisplayName = session.session.displayName?.trim();
  if (!inviterDisplayName) return { type: "share-unavailable" };

  const result = await dependencies.createInvitation(accountData, compatibilityData, {
    inviterAccountId: session.session.accountId,
    inviterDisplayName,
    relationshipCategory,
  });
  const invitationUrl = createCompatibilityInvitationUrl(liff.liffId, result.relationship.id);
  return {
    type: "created",
    invitationUrl,
    expiresAt: result.relationship.expiresAt.toISOString(),
    relationshipCategory: result.relationship.relationshipCategory,
  };
}
