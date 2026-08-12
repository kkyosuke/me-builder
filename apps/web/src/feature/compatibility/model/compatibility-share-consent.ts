export type CompatibilityShareConsentBlockingReason = "display_name_unavailable";

/** 招待リンクを発行する前に、相手へ見える名前と共有可否だけを示す。 */
export type CompatibilityShareConsent = {
  displayName: string | null;
  avatarUrl: string | null;
  canShare: boolean;
  blockingReasons: CompatibilityShareConsentBlockingReason[];
  nextAction: "diagnosis" | "profile-summary" | null;
};
