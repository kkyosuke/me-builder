export type ServiceTermsAcceptanceSummary = Readonly<{
  required: boolean;
  acceptedVersion: string | null;
  documentHash: string | null;
  acceptedAt: string | null;
}>;

export type ServiceTermsNoticeSummary = Readonly<{
  type: "important-upcoming" | "minor-update";
  document: Readonly<{
    version: string;
    summary: string;
  }>;
  effectiveAt: string;
  displayUntil: string;
}>;

/** 本人向けAPIを開始できるか判断するための、規約本文を含まない起動情報。 */
export type ServiceTermsStartupStatus = Readonly<{
  document: Readonly<{
    version: string;
    contentHash: string;
  }>;
  notice: ServiceTermsNoticeSummary | null;
  acceptance: ServiceTermsAcceptanceSummary;
}>;
