type ServiceTerms = Readonly<{
  documentKey: "terms_of_service";
  version: string;
  contentHash: string;
  requiresReacceptance: boolean;
  publishedAt: string;
  title: string;
  summary: string;
  sections: readonly Readonly<{ heading: string; paragraphs: readonly string[] }>[];
}>;

export type ServiceTermsStatus = Readonly<{
  document: ServiceTerms;
  acceptance: Readonly<{
    required: boolean;
    acceptedVersion: string | null;
    documentHash: string | null;
    acceptedAt: string | null;
  }>;
}>;

export type ServiceTermsAcceptanceHistoryItem = Readonly<{
  documentKey: "terms_of_service";
  version: string;
  documentHash: string | null;
  acceptedAt: string;
  status: "current" | "past";
}>;
