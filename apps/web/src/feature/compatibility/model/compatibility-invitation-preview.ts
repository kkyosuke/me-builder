export type CompatibilityInvitationPreviewBlockingReason = "display_name_unavailable";

/** 承諾前に受信者へ見せるのは、誰からの招待かと自分が共有を始められるかだけ。 */
export type CompatibilityInvitationPreview = {
  inviter: { displayName: string; avatarUrl: string | null };
  recipient: { displayName: string | null; avatarUrl: string | null };
  expiresAt: string;
  canAccept: boolean;
  blockingReasons: CompatibilityInvitationPreviewBlockingReason[];
  nextAction: "diagnosis" | "profile-summary" | null;
};
