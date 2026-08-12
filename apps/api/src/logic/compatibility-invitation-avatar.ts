import type { R2Bucket } from "@cloudflare/workers-types";
import {
  type CompatibilityDataNamespace,
  type CompatibilityInvitationAcceptanceContext,
  type CompatibilityInvitationPreview,
  type D1,
  compatibilityDataFor,
  compatibilityRelationshipId,
} from "@me-builder/lib";
import { createLiffSession } from "./liff-session";
import { type ProfileAvatarImage, resolveProfileAvatarImage } from "./profile-avatar-image";

type Params = Readonly<{
  relationshipId: string;
  idToken: string | undefined;
  lineLoginChannelId: string | undefined;
  db: D1.shared.Client;
  avatarBucket: R2Bucket;
  lineChannelAccessToken?: string | undefined;
  compatibilityData: CompatibilityDataNamespace;
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
  resolveAvatarImage: typeof resolveProfileAvatarImage;
}>;

const defaultDependencies: Dependencies = {
  createSession: createLiffSession,
  getInvitationPreview: (namespace, relationshipId, viewerAccountId) =>
    compatibilityDataFor(namespace, relationshipId).getInvitationPreview(viewerAccountId),
  getInvitationContext: (namespace, relationshipId) =>
    compatibilityDataFor(namespace, relationshipId).getInvitationAcceptanceContext(),
  resolveAvatarImage: resolveProfileAvatarImage,
};

export type CompatibilityInvitationAvatarOutcome =
  | { type: "resolved"; image: ProfileAvatarImage }
  | { type: "image-unavailable" }
  | { type: "unavailable" }
  | { type: "own-invitation" }
  | { type: "not-configured" }
  | { type: "unauthenticated"; reason: string }
  | { type: "account-not-found" };

/** pending招待を確認できる受信者だけに、招待contextの送信者画像を返す。 */
export async function getCompatibilityInvitationAvatar(
  params: Params,
  dependencies: Dependencies = defaultDependencies,
): Promise<CompatibilityInvitationAvatarOutcome> {
  if (!compatibilityRelationshipId.isValid(params.relationshipId)) return { type: "unavailable" };
  const session = await dependencies.createSession(params);
  if (session.type !== "resolved") return session;

  const preview = await dependencies.getInvitationPreview(
    params.compatibilityData,
    params.relationshipId,
    session.session.accountId,
  );
  if (!preview) return { type: "unavailable" };
  if (preview.isOwnInvitation) return { type: "own-invitation" };

  const context = await dependencies.getInvitationContext(
    params.compatibilityData,
    params.relationshipId,
  );
  if (!context) return { type: "unavailable" };

  const image = await dependencies.resolveAvatarImage({
    accountId: context.inviterAccountId,
    db: params.db,
    avatarBucket: params.avatarBucket,
    lineChannelAccessToken: params.lineChannelAccessToken,
  });
  return image ? { type: "resolved", image } : { type: "image-unavailable" };
}
