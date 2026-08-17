export const WEB_CLIENT_ERROR_KINDS = [
  "unhandled-error",
  "unhandled-rejection",
  "render-error",
  "chunk-load-error",
] as const;

export type WebClientErrorKind = (typeof WEB_CLIENT_ERROR_KINDS)[number];

export const WEB_CLIENT_ERROR_TYPES = [
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "AggregateError",
  "DOMException",
  "NonError",
  "Unknown",
] as const;

export type WebClientErrorType = (typeof WEB_CLIENT_ERROR_TYPES)[number];

export const WEB_CLIENT_ROUTES = [
  "/",
  "/terms",
  "/privacy",
  "/contact",
  "/diagnosis",
  "/diagnosis/:diagnosisId/answers",
  "/compatibility",
  "/compatibility/share",
  "/compatibility/invitations/:relationshipId",
  "/compatibility/relationships/:relationshipId",
  "/me",
  "/profile",
  "/profile/avatar",
  "/profile/personal-data",
  "/profile/family",
  "/profile/billing",
  "/profile/brain-items",
  "/admin",
  "/admin/statistics",
  "/account-recovery",
  "unknown",
] as const;

export type WebClientRoute = (typeof WEB_CLIENT_ROUTES)[number];

export type WebClientErrorReport = Readonly<{
  schemaVersion: 1;
  kind: WebClientErrorKind;
  route: WebClientRoute;
  release: string;
  errorType: WebClientErrorType;
  sourceFile?: string;
  sourceLine?: number;
  sourceColumn?: number;
  online: boolean;
  recovered: boolean;
}>;
