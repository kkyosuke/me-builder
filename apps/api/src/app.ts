import {
  describeHttpResult,
  httpOutcome,
  logger,
  operationalLogLevel,
  toSafeOperationalErrorFields,
} from "@me-builder/shared";
import { Hono } from "hono";
import { generateSpecs } from "hono-openapi";
import { cors } from "hono/cors";
import * as v from "valibot";
import { getConfig } from "./config";
import {
  accountRecoveryCodeRoute,
  accountRecoveryCompleteRoute,
} from "./contract/account-recovery";
import { adminAccountsRoute } from "./contract/admin/accounts";
import { adminBillingHealthRoute } from "./contract/admin/billing-health";
import { adminBillingReconciliationRoute } from "./contract/admin/billing-reconciliation";
import { adminStatisticsRoute } from "./contract/admin/statistics";
import {
  completeSsoCallbackRoute,
  getSsoIdentityStatusRoute,
  startSsoIdentityLinkRoute,
  startSsoLoginRoute,
  unlinkSsoIdentityRoute,
} from "./contract/auth/sso-identity";
import {
  applicationSessionRoute,
  liffAuthenticationExchangeRoute,
  logoutApplicationSessionRoute,
} from "./contract/authentication";
import {
  billingCheckoutSessionRoute,
  billingCheckoutSessionStatusRoute,
  billingPlanCatalogRoute,
  billingPlanChangeSessionRoute,
  billingPortalSessionRoute,
  billingTrialEligibilityRoute,
} from "./contract/billing/sessions";
import { stripeWebhookRoute } from "./contract/billing/webhook";
import { developmentBrainItemsRoute, developmentBrainVectorRoute } from "./contract/brain/dev-list";
import {
  developmentFailedBrainVectorSyncJobsRoute,
  resetAllDevelopmentBrainVectorSyncJobsRoute,
  resetDevelopmentBrainVectorSyncJobRoute,
} from "./contract/brain/dev-vector-sync-jobs";
import {
  issueCompatibilityInvitationRequestValidator,
  issueCompatibilityInvitationRoute,
} from "./contract/compatibility/invitation";
import { acceptCompatibilityInvitationRoute } from "./contract/compatibility/invitation-accept";
import { compatibilityInvitationAvatarRoute } from "./contract/compatibility/invitation-avatar";
import { compatibilityInvitationCancelRoute } from "./contract/compatibility/invitation-cancel";
import { compatibilityInvitationPreviewRoute } from "./contract/compatibility/invitation-preview";
import { compatibilityRelationshipRoute } from "./contract/compatibility/relationship";
import { compatibilityRelationshipEndRoute } from "./contract/compatibility/relationship-end";
import { compatibilityRelationshipsRoute } from "./contract/compatibility/relationships";
import { compatibilityShareConsentRoute } from "./contract/compatibility/share-consent";
import { compatibilityShareContentRoute } from "./contract/compatibility/share-content";
import { resetDevelopmentAccountDataRoute } from "./contract/development/account-data-reset";
import { saveDiagnosisAnswerRoute } from "./contract/diagnosis/answer";
import { diagnosisAnswersRoute } from "./contract/diagnosis/answers";
import { deferDiagnosisQuestionRoute } from "./contract/diagnosis/deferred-question";
import { diagnosisDetailRoute } from "./contract/diagnosis/detail";
import { diagnosisListRoute } from "./contract/diagnosis/list";
import {
  acceptFamilyInvitationRoute,
  cancelFamilyInvitationRoute,
  declineFamilyInvitationRoute,
  familyInvitationTokenValidator,
  familySeatManagementRoute,
  issueFamilyInvitationRoute,
  leaveFamilyPackRoute,
  removeFamilyMemberRoute,
} from "./contract/family/seats";
import { HealthResponseSchema, healthRoute } from "./contract/health";
import {
  acceptServiceTermsRequestValidator,
  acceptServiceTermsRoute,
  getServiceTermsAcceptanceHistoryRoute,
  getServiceTermsRoute,
} from "./contract/legal/terms";
import { lineWebhookRoute } from "./contract/line/webhook";
import { webClientErrorReportRoute } from "./contract/observability/web-client-error";
import { openApiOptions } from "./contract/openapi";
import {
  downloadPersonalDataExportRoute,
  personalDataExportStatusRoute,
  requestPersonalDataExportRoute,
} from "./contract/personal-data/exports";
import {
  correctPersonalDataRecordRoute,
  deletePersonalDataRecordRoute,
  personalDataRecordsRoute,
} from "./contract/personal-data/records";
import { profileEntitlementRoute } from "./contract/profile/entitlement";
import {
  goalFollowUpAgreementRoute,
  goalFollowUpListRoute,
  goalFollowUpUpdateRoute,
} from "./contract/profile/goal-follow-up";
import {
  deleteProfileAvatarRoute,
  getProfileAvatarImageRoute,
  getProfileRoute,
  putProfileAvatarRoute,
} from "./contract/profile/profile";
import { profileProgressionRoute } from "./contract/profile/progression";
import {
  selfCareContextConfirmationRoute,
  selfCareContextListRoute,
  selfCareContextRevocationRoute,
} from "./contract/profile/self-care-context";
import { profileSummaryGenerationRoute, profileSummaryRoute } from "./contract/profile/summary";
import {
  weeklyReflectionGenerationRoute,
  weeklyReflectionRoute,
} from "./contract/profile/weekly-reflection";
import {
  type RuntimeContractDocument,
  assertRuntimeResponseContract,
} from "./contract/runtime-response";
import { InternalServerErrorSchema } from "./contract/shared/errors";
import {
  postAccountRecoveryCode,
  postAccountRecoveryComplete,
} from "./controller/account-recovery";
import {
  getAccounts,
  getBillingHealth,
  getStatistics,
  postBillingReconciliation,
} from "./controller/admin";
import {
  deleteApplicationSession,
  getApplicationSession,
  postLiffAuthenticationExchange,
} from "./controller/authentication";
import {
  getBillingCheckoutSession,
  getBillingPlanCatalog,
  getBillingTrialEligibilityResponse,
  postBillingCheckoutSession,
  postBillingPlanChangeSession,
  postBillingPortalSession,
  postStripeWebhook,
} from "./controller/billing";
import {
  getDevelopmentBrainItems,
  getDevelopmentBrainVector,
  getDevelopmentFailedBrainVectorSyncJobs,
  postDevelopmentBrainVectorSyncJobReset,
  postDevelopmentBrainVectorSyncJobsResetAll,
} from "./controller/brain";
import {
  deleteCompatibilityInvitation,
  deleteCompatibilityRelationship,
  getCompatibilityInvitation,
  getCompatibilityInvitationAvatarContents,
  getCompatibilityRelationship,
  getCompatibilityRelationships,
  getCompatibilityShareConsentContents,
  getCompatibilityShareContentContents,
  postCompatibilityInvitation,
  postCompatibilityInvitationAcceptance,
} from "./controller/compatibility";
import { deleteDevelopmentAccountData } from "./controller/development";
import {
  getDiagnoses,
  getDiagnosis,
  getDiagnosisAnswerContents,
  putDiagnosisAnswer,
  putDiagnosisDeferredQuestion,
} from "./controller/diagnosis";
import {
  deleteFamilyInvitation,
  deleteFamilyMember,
  deleteOwnFamilyMembership,
  getFamilySeats,
  postFamilyInvitation,
  postFamilyInvitationAcceptance,
  postFamilyInvitationDecline,
} from "./controller/family";
import {
  getServiceTermsAcceptanceHistoryContents,
  getServiceTermsContents,
  putServiceTermsAcceptance,
} from "./controller/legal";
import { postLineWebhook } from "./controller/line";
import { postWebClientError } from "./controller/observability";
import {
  deletePersonalDataRecordContents,
  downloadPersonalDataExportContents,
  getPersonalDataExportStatus,
  getPersonalDataRecords,
  patchPersonalDataRecord,
  postPersonalDataExport,
} from "./controller/personal-data";
import {
  getGoalFollowUpContents,
  getProfileEntitlementContents,
  getProfileProgressionContents,
  getProfileSummaryContents,
  getWeeklyReflectionContents,
  patchGoalFollowUp,
  postGoalFollowUpAgreement,
  postProfileSummaryGeneration,
  postWeeklyReflectionGeneration,
} from "./controller/profile";
import {
  deleteProfileAvatarContents,
  getProfileAvatarImageContents,
  getProfileContents,
  putProfileAvatar,
} from "./controller/profile-avatar";
import {
  deleteSelfCareContextConfirmation,
  getSelfCareContextContents,
  postSelfCareContextConfirmation,
} from "./controller/self-care-context";
import {
  deleteSsoIdentity,
  getSsoCallback,
  getSsoIdentityStatusContents,
  postSsoIdentityLink,
  postSsoLogin,
} from "./controller/sso-identity";
import { requireAuthentication } from "./middleware/authentication";
import {
  requireAdmin,
  requireCurrentTerms,
  requireDevelopmentEnvironment,
} from "./middleware/authorization";
import { operationalHttpPath } from "./operational-http-path";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();
let openApiDocumentPromise: ReturnType<typeof generateSpecs> | undefined;

export function generateOpenApiDocument() {
  openApiDocumentPromise ??= generateSpecs(app, openApiOptions);
  return openApiDocumentPromise;
}

const webCors = cors({
  origin: (origin, c) => (origin === getConfig(c.env).webOrigin ? origin : undefined),
  allowHeaders: ["Content-Type", "X-CSRF-Token"],
  credentials: true,
});

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (!origin || origin !== getConfig(c.env).webOrigin) return next();
  return webCors(c, next);
});

app.use("/api/*", async (c, next) => {
  await next();
  const routePath = c.req.routePath;
  if (routePath === "/api/openapi.json" || routePath === "/api/*") return;
  assertRuntimeResponseContract(
    (await generateOpenApiDocument()) as RuntimeContractDocument,
    c.req.method,
    routePath,
    c.res,
  );
});

// 例外の分類はここでしか作れないが、最終statusを知るのはmiddlewareなので、
// 記録はせずに安全な分類だけを預けて終端ログ1件へまとめる。
// errをそのまま載せると、SDK例外が抱えるrequest/response bodyがlogへ流出しうる。
app.onError((err, c) => {
  c.set(
    "safeError",
    toSafeOperationalErrorFields(err, {
      code: "UNEXPECTED_API_ERROR",
      category: "unknown",
      stage: "http.handle",
      retryable: false,
    }),
  );
  return c.json(v.parse(InternalServerErrorSchema, { error: "Internal Server Error" }), 500);
});

app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  if (c.get("terminalLogOwnedByRoute")) return;
  const responseTimeMs = Date.now() - start;
  const status = c.res.status;
  const path = operationalHttpPath(c.req.path);
  const safeError = c.get("safeError");
  const outcome = httpOutcome(status);
  const fields = {
    event: outcome === "failed" ? "http.request.failed" : "http.request.completed",
    service: "api",
    method: c.req.method,
    path,
    status,
    outcome,
    responseTimeMs,
    ...(safeError ?? {}),
  };
  const description = describeHttpResult({
    service: "API",
    method: c.req.method,
    path,
    status,
    durationMs: responseTimeMs,
    ...(safeError ? { errorCode: safeError.errorCode } : {}),
  });
  const level = operationalLogLevel(outcome);
  if (level === "error") logger.error(fields, description);
  else if (level === "info") logger.info(fields, description);
  else logger.warn(fields, description);
});

app.get("/api/health", healthRoute, (c) => {
  const currentConfig = getConfig(c.env);
  return c.json(
    v.parse(HealthResponseSchema, {
      status: "ok",
      environment: currentConfig.environment,
      timestamp: new Date().toISOString(),
    }),
  );
});

app.post(
  "/api/observability/web-errors",
  requireAuthentication,
  requireCurrentTerms,
  webClientErrorReportRoute,
  postWebClientError,
);
app.post("/api/line/webhook", lineWebhookRoute, postLineWebhook);
app.get(
  "/api/auth/sso/identity",
  getSsoIdentityStatusRoute,
  requireAuthentication,
  getSsoIdentityStatusContents,
);
app.delete(
  "/api/auth/sso/identity",
  unlinkSsoIdentityRoute,
  requireAuthentication,
  deleteSsoIdentity,
);
app.post(
  "/api/auth/sso/link",
  startSsoIdentityLinkRoute,
  requireAuthentication,
  postSsoIdentityLink,
);
app.post("/api/auth/sso/login", startSsoLoginRoute, postSsoLogin);
app.get("/api/auth/sso/callback", completeSsoCallbackRoute, getSsoCallback);
app.post("/api/billing/webhook", stripeWebhookRoute, postStripeWebhook);
app.post(
  "/api/auth/liff/exchange",
  liffAuthenticationExchangeRoute,
  postLiffAuthenticationExchange,
);
app.get("/api/auth/session", requireAuthentication, applicationSessionRoute, getApplicationSession);
app.delete(
  "/api/auth/session",
  requireAuthentication,
  logoutApplicationSessionRoute,
  deleteApplicationSession,
);
app.post(
  "/api/account-recovery/codes",
  requireAuthentication,
  requireCurrentTerms,
  accountRecoveryCodeRoute,
  postAccountRecoveryCode,
);
app.post(
  "/api/account-recovery/complete",
  requireAuthentication,
  accountRecoveryCompleteRoute,
  postAccountRecoveryComplete,
);
app.get("/api/billing/plans", billingPlanCatalogRoute, getBillingPlanCatalog);
app.get(
  "/api/billing/trial-eligibility",
  requireAuthentication,
  requireCurrentTerms,
  billingTrialEligibilityRoute,
  getBillingTrialEligibilityResponse,
);
app.post(
  "/api/billing/checkout-sessions",
  requireAuthentication,
  requireCurrentTerms,
  billingCheckoutSessionRoute,
  postBillingCheckoutSession,
);
app.post(
  "/api/billing/plan-change-sessions",
  requireAuthentication,
  requireCurrentTerms,
  billingPlanChangeSessionRoute,
  postBillingPlanChangeSession,
);
app.get(
  "/api/billing/checkout-sessions/:checkoutSessionId",
  requireAuthentication,
  requireCurrentTerms,
  billingCheckoutSessionStatusRoute,
  getBillingCheckoutSession,
);
app.post(
  "/api/billing/portal-sessions",
  requireAuthentication,
  requireCurrentTerms,
  billingPortalSessionRoute,
  postBillingPortalSession,
);

app.get("/api/legal/terms", requireAuthentication, getServiceTermsRoute, getServiceTermsContents);
app.get(
  "/api/legal/terms/acceptances",
  requireAuthentication,
  getServiceTermsAcceptanceHistoryRoute,
  getServiceTermsAcceptanceHistoryContents,
);
app.put(
  "/api/legal/terms/acceptance",
  requireAuthentication,
  acceptServiceTermsRoute,
  acceptServiceTermsRequestValidator,
  putServiceTermsAcceptance,
);

app.get(
  "/api/admin/statistics",
  requireAuthentication,
  requireCurrentTerms,
  requireAdmin,
  adminStatisticsRoute,
  getStatistics,
);
app.get(
  "/api/admin/accounts",
  requireAuthentication,
  requireCurrentTerms,
  requireAdmin,
  adminAccountsRoute,
  getAccounts,
);
app.get(
  "/api/admin/billing/health",
  requireAuthentication,
  requireCurrentTerms,
  requireAdmin,
  adminBillingHealthRoute,
  getBillingHealth,
);
app.post(
  "/api/admin/billing/reconciliation",
  requireAuthentication,
  requireCurrentTerms,
  requireAdmin,
  adminBillingReconciliationRoute,
  postBillingReconciliation,
);

app.get(
  "/api/profile-summary",
  requireAuthentication,
  requireCurrentTerms,
  profileSummaryRoute,
  getProfileSummaryContents,
);
app.post(
  "/api/profile-summary/generations",
  requireAuthentication,
  requireCurrentTerms,
  profileSummaryGenerationRoute,
  postProfileSummaryGeneration,
);
app.get(
  "/api/weekly-reflections",
  requireAuthentication,
  requireCurrentTerms,
  weeklyReflectionRoute,
  getWeeklyReflectionContents,
);
app.post(
  "/api/weekly-reflections/generations",
  requireAuthentication,
  requireCurrentTerms,
  weeklyReflectionGenerationRoute,
  postWeeklyReflectionGeneration,
);
app.get(
  "/api/goal-follow-ups",
  requireAuthentication,
  requireCurrentTerms,
  goalFollowUpListRoute,
  getGoalFollowUpContents,
);
app.post(
  "/api/goal-follow-ups",
  requireAuthentication,
  requireCurrentTerms,
  goalFollowUpAgreementRoute,
  postGoalFollowUpAgreement,
);
app.patch(
  "/api/goal-follow-ups/:goalFollowUpId",
  requireAuthentication,
  requireCurrentTerms,
  goalFollowUpUpdateRoute,
  patchGoalFollowUp,
);
app.get(
  "/api/profile",
  requireAuthentication,
  requireCurrentTerms,
  getProfileRoute,
  getProfileContents,
);
app.get(
  "/api/profile/entitlement",
  requireAuthentication,
  requireCurrentTerms,
  profileEntitlementRoute,
  getProfileEntitlementContents,
);
app.get(
  "/api/profile/progression",
  requireAuthentication,
  requireCurrentTerms,
  profileProgressionRoute,
  getProfileProgressionContents,
);
app.get(
  "/api/profile/avatar",
  requireAuthentication,
  requireCurrentTerms,
  getProfileAvatarImageRoute,
  getProfileAvatarImageContents,
);
app.put(
  "/api/profile/avatar",
  requireAuthentication,
  requireCurrentTerms,
  putProfileAvatarRoute,
  putProfileAvatar,
);
app.delete(
  "/api/profile/avatar",
  requireAuthentication,
  requireCurrentTerms,
  deleteProfileAvatarRoute,
  deleteProfileAvatarContents,
);

app.get(
  "/api/personal-data/records",
  requireAuthentication,
  requireCurrentTerms,
  personalDataRecordsRoute,
  getPersonalDataRecords,
);
app.patch(
  "/api/personal-data/records/:sourceRecordId",
  requireAuthentication,
  requireCurrentTerms,
  correctPersonalDataRecordRoute,
  patchPersonalDataRecord,
);
app.get(
  "/api/self-care/contexts",
  requireAuthentication,
  requireCurrentTerms,
  selfCareContextListRoute,
  getSelfCareContextContents,
);
app.post(
  "/api/self-care/contexts",
  requireAuthentication,
  requireCurrentTerms,
  selfCareContextConfirmationRoute,
  postSelfCareContextConfirmation,
);
app.delete(
  "/api/self-care/contexts/:selfCareContextId",
  requireAuthentication,
  requireCurrentTerms,
  selfCareContextRevocationRoute,
  deleteSelfCareContextConfirmation,
);
app.delete(
  "/api/personal-data/records/:sourceRecordId",
  requireAuthentication,
  requireCurrentTerms,
  deletePersonalDataRecordRoute,
  deletePersonalDataRecordContents,
);

app.get(
  "/api/family/seats",
  requireAuthentication,
  requireCurrentTerms,
  familySeatManagementRoute,
  getFamilySeats,
);
app.post(
  "/api/family/invitations",
  requireAuthentication,
  requireCurrentTerms,
  issueFamilyInvitationRoute,
  postFamilyInvitation,
);
app.post(
  "/api/family/invitations/accept",
  requireAuthentication,
  requireCurrentTerms,
  acceptFamilyInvitationRoute,
  familyInvitationTokenValidator,
  postFamilyInvitationAcceptance,
);
app.post(
  "/api/family/invitations/decline",
  requireAuthentication,
  requireCurrentTerms,
  declineFamilyInvitationRoute,
  familyInvitationTokenValidator,
  postFamilyInvitationDecline,
);
app.delete(
  "/api/family/invitations/:seatId",
  requireAuthentication,
  requireCurrentTerms,
  cancelFamilyInvitationRoute,
  deleteFamilyInvitation,
);
app.delete(
  "/api/family/seats/:seatId",
  requireAuthentication,
  requireCurrentTerms,
  removeFamilyMemberRoute,
  deleteFamilyMember,
);
app.delete(
  "/api/family/membership",
  requireAuthentication,
  requireCurrentTerms,
  leaveFamilyPackRoute,
  deleteOwnFamilyMembership,
);
app.post(
  "/api/personal-data/exports",
  requireAuthentication,
  requireCurrentTerms,
  requestPersonalDataExportRoute,
  postPersonalDataExport,
);
app.get(
  "/api/personal-data/exports/:exportId",
  requireAuthentication,
  requireCurrentTerms,
  personalDataExportStatusRoute,
  getPersonalDataExportStatus,
);
app.get(
  "/api/personal-data/exports/:exportId/download",
  requireAuthentication,
  requireCurrentTerms,
  downloadPersonalDataExportRoute,
  downloadPersonalDataExportContents,
);

app.get(
  "/api/dev/brain-items",
  requireDevelopmentEnvironment,
  requireAuthentication,
  requireCurrentTerms,
  developmentBrainItemsRoute,
  getDevelopmentBrainItems,
);
app.get(
  "/api/dev/brain-items/:brainItemId/vector",
  requireDevelopmentEnvironment,
  requireAuthentication,
  requireCurrentTerms,
  developmentBrainVectorRoute,
  getDevelopmentBrainVector,
);
app.post(
  "/api/compatibility/invitations/:relationshipId/accept",
  requireAuthentication,
  requireCurrentTerms,
  acceptCompatibilityInvitationRoute,
  postCompatibilityInvitationAcceptance,
);
app.post(
  "/api/compatibility/invitations",
  requireAuthentication,
  requireCurrentTerms,
  issueCompatibilityInvitationRoute,
  issueCompatibilityInvitationRequestValidator,
  postCompatibilityInvitation,
);
app.get(
  "/api/compatibility/invitations/:relationshipId/avatar",
  requireAuthentication,
  requireCurrentTerms,
  compatibilityInvitationAvatarRoute,
  getCompatibilityInvitationAvatarContents,
);
app.get(
  "/api/compatibility/invitations/:relationshipId",
  requireAuthentication,
  requireCurrentTerms,
  compatibilityInvitationPreviewRoute,
  getCompatibilityInvitation,
);
app.delete(
  "/api/compatibility/invitations/:relationshipId",
  requireAuthentication,
  requireCurrentTerms,
  compatibilityInvitationCancelRoute,
  deleteCompatibilityInvitation,
);
app.get(
  "/api/compatibility/relationships",
  requireAuthentication,
  requireCurrentTerms,
  compatibilityRelationshipsRoute,
  getCompatibilityRelationships,
);
app.get(
  "/api/compatibility/relationships/:relationshipId",
  requireAuthentication,
  requireCurrentTerms,
  compatibilityRelationshipRoute,
  getCompatibilityRelationship,
);
app.delete(
  "/api/compatibility/relationships/:relationshipId",
  requireAuthentication,
  requireCurrentTerms,
  compatibilityRelationshipEndRoute,
  deleteCompatibilityRelationship,
);
app.get(
  "/api/dev/brain-vector-sync-jobs/failed",
  requireDevelopmentEnvironment,
  requireAuthentication,
  requireCurrentTerms,
  developmentFailedBrainVectorSyncJobsRoute,
  getDevelopmentFailedBrainVectorSyncJobs,
);
app.post(
  "/api/dev/brain-vector-sync-jobs/reset-failed",
  requireDevelopmentEnvironment,
  requireAuthentication,
  requireCurrentTerms,
  resetAllDevelopmentBrainVectorSyncJobsRoute,
  postDevelopmentBrainVectorSyncJobsResetAll,
);
app.post(
  "/api/dev/brain-vector-sync-jobs/:jobId/reset",
  requireDevelopmentEnvironment,
  requireAuthentication,
  requireCurrentTerms,
  resetDevelopmentBrainVectorSyncJobRoute,
  postDevelopmentBrainVectorSyncJobReset,
);
app.get(
  "/api/compatibility/share-consent",
  requireAuthentication,
  requireCurrentTerms,
  compatibilityShareConsentRoute,
  getCompatibilityShareConsentContents,
);
app.get(
  "/api/compatibility/share-content",
  requireAuthentication,
  requireCurrentTerms,
  compatibilityShareContentRoute,
  getCompatibilityShareContentContents,
);

app.get(
  "/api/diagnoses",
  requireAuthentication,
  requireCurrentTerms,
  diagnosisListRoute,
  getDiagnoses,
);
app.get(
  "/api/diagnoses/:diagnosisId",
  requireAuthentication,
  requireCurrentTerms,
  diagnosisDetailRoute,
  getDiagnosis,
);
app.get(
  "/api/diagnoses/:diagnosisId/answers",
  requireAuthentication,
  requireCurrentTerms,
  diagnosisAnswersRoute,
  getDiagnosisAnswerContents,
);
app.put(
  "/api/diagnoses/:diagnosisId/answers/:diagnosisQuestionId",
  requireAuthentication,
  requireCurrentTerms,
  saveDiagnosisAnswerRoute,
  putDiagnosisAnswer,
);
app.put(
  "/api/diagnoses/:diagnosisId/deferred-questions/:diagnosisQuestionId",
  requireAuthentication,
  requireCurrentTerms,
  deferDiagnosisQuestionRoute,
  putDiagnosisDeferredQuestion,
);
app.delete(
  "/api/dev/account-data",
  requireDevelopmentEnvironment,
  requireAuthentication,
  requireCurrentTerms,
  resetDevelopmentAccountDataRoute,
  deleteDevelopmentAccountData,
);

// Web UIの型生成にも使う、機械可読なAPI契約。
app.get("/api/openapi.json", async (c) => c.json(await generateOpenApiDocument()));

app.get("/", (c) => c.text("me-builder API Server running!"));

export { app };
