import type {
  ServiceTermsAcceptanceSummary,
  ServiceTermsNoticeSummary,
} from "../../../model/web-startup";

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
  notice:
    | (ServiceTermsNoticeSummary &
        Readonly<{
          document: ServiceTerms;
        }>)
    | null;
  acceptance: ServiceTermsAcceptanceSummary;
}>;

export type ServiceTermsAcceptanceHistoryItem = Readonly<{
  documentKey: "terms_of_service";
  version: string;
  documentHash: string | null;
  acceptedAt: string;
  status: "current" | "past";
}>;
