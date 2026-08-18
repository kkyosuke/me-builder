type ProfileEntitlementUsage = Readonly<{
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
  periodStartsAt: string;
  resetsAt: string;
}>;

export type ProfileEntitlement = Readonly<{
  status: "free" | "active" | "safe-default";
  plan: "free" | "lite" | "full" | "family";
  source: "free" | "subscription" | "family-seat";
  effectiveAt: string;
  availableUntil: string | null;
  aiReply: ProfileEntitlementUsage;
}>;
