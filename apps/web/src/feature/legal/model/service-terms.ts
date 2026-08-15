type ServiceTerms = Readonly<{
  documentKey: "terms_of_service";
  version: string;
  publishedAt: string;
  title: string;
  summary: string;
  sections: readonly Readonly<{ heading: string; paragraphs: readonly string[] }>[];
}>;

export type ServiceTermsStatus = Readonly<{
  document: ServiceTerms;
  acceptance: Readonly<{ required: boolean; acceptedAt: string | null }>;
}>;
