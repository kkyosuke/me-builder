export const WEB_CLIENT_ERROR_KINDS = [
  "unhandled-error",
  "unhandled-rejection",
  "render-error",
  "chunk-load-error",
  "handled-operation-error",
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

export const WEB_CLIENT_OPERATIONS = [
  "billing-checkout",
  "billing-plan-change",
  "billing-portal",
] as const;

export type WebClientOperation = (typeof WEB_CLIENT_OPERATIONS)[number];

/** ブラウザから運用ログへ送信してよい、機密情報を含まない固定エラーコード。 */
export const WEB_CLIENT_OPERATION_ERROR_CODES = [
  "BILLING_CHECKOUT_NETWORK_FAILED",
  "BILLING_CHECKOUT_UNAVAILABLE",
  "BILLING_CHECKOUT_FAILED",
  "BILLING_CHECKOUT_RESPONSE_INVALID",
  "BILLING_PLAN_CHANGE_NETWORK_FAILED",
  "BILLING_PLAN_CHANGE_UNAVAILABLE",
  "BILLING_PLAN_CHANGE_FAILED",
  "BILLING_PLAN_CHANGE_RESPONSE_INVALID",
  "BILLING_PORTAL_NETWORK_FAILED",
  "BILLING_CUSTOMER_NOT_FOUND",
  "BILLING_PORTAL_FAILED",
  "BILLING_PORTAL_RESPONSE_INVALID",
  "UNKNOWN_CLIENT_OPERATION_ERROR",
] as const;

export type WebClientOperationErrorCode = (typeof WEB_CLIENT_OPERATION_ERROR_CODES)[number];

export const WEB_CLIENT_ROUTES = [
  "/",
  "/terms",
  "/privacy",
  "/contact",
  "/commercial-transactions",
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
  operation?: WebClientOperation;
  operationErrorCode?: WebClientOperationErrorCode;
  operationStatus?: number;
  online: boolean;
  recovered: boolean;
}>;
