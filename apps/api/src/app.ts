import {
  describeHttpResult,
  httpOutcome,
  logger,
  operationalLogLevel,
  toSafeOperationalErrorFields,
} from "@me-builder/shared";
import { Hono } from "hono";
import { openAPIRouteHandler } from "hono-openapi";
import { cors } from "hono/cors";
import * as v from "valibot";
import { getConfig } from "./config";
import { adminStatisticsRoute } from "./contract/admin/statistics";
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
import { openApiOptions } from "./contract/openapi";
import {
  deleteProfileAvatarRoute,
  getProfileAvatarImageRoute,
  getProfileRoute,
  putProfileAvatarRoute,
} from "./contract/profile/profile";
import { profileSummaryGenerationRoute, profileSummaryRoute } from "./contract/profile/summary";
import { InternalServerErrorSchema } from "./contract/shared/errors";
import { getStatistics } from "./controller/admin";
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
import { postLineWebhook } from "./controller/line";
import { getProfileSummaryContents, postProfileSummaryGeneration } from "./controller/profile";
import {
  deleteProfileAvatarContents,
  getProfileAvatarImageContents,
  getProfileContents,
  putProfileAvatar,
} from "./controller/profile-avatar";
import { operationalHttpPath } from "./operational-http-path";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();
const webCors = cors({
  origin: (origin, c) => (origin === getConfig(c.env).webOrigin ? origin : undefined),
  allowHeaders: ["Authorization", "Content-Type"],
});

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (!origin || origin !== getConfig(c.env).webOrigin) return next();
  return webCors(c, next);
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

app.get("/api/health", (c) => {
  const currentConfig = getConfig(c.env);
  return c.json({
    status: "ok",
    environment: currentConfig.environment,
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/line/webhook", postLineWebhook);

app.get("/api/admin/statistics", adminStatisticsRoute, getStatistics);

app.get("/api/profile-summary", profileSummaryRoute, getProfileSummaryContents);
app.post(
  "/api/profile-summary/generations",
  profileSummaryGenerationRoute,
  postProfileSummaryGeneration,
);
app.get("/api/profile", getProfileRoute, getProfileContents);
app.get("/api/profile/avatar", getProfileAvatarImageRoute, getProfileAvatarImageContents);
app.put("/api/profile/avatar", putProfileAvatarRoute, putProfileAvatar);
app.delete("/api/profile/avatar", deleteProfileAvatarRoute, deleteProfileAvatarContents);

app.get("/api/dev/brain-items", developmentBrainItemsRoute, getDevelopmentBrainItems);
app.get(
  "/api/dev/brain-items/:brainItemId/vector",
  developmentBrainVectorRoute,
  getDevelopmentBrainVector,
);
app.post(
  "/api/compatibility/invitations/:relationshipId/accept",
  acceptCompatibilityInvitationRoute,
  postCompatibilityInvitationAcceptance,
);
app.post(
  "/api/compatibility/invitations",
  issueCompatibilityInvitationRoute,
  issueCompatibilityInvitationRequestValidator,
  postCompatibilityInvitation,
);
app.get(
  "/api/compatibility/invitations/:relationshipId/avatar",
  compatibilityInvitationAvatarRoute,
  getCompatibilityInvitationAvatarContents,
);
app.get(
  "/api/compatibility/invitations/:relationshipId",
  compatibilityInvitationPreviewRoute,
  getCompatibilityInvitation,
);
app.delete(
  "/api/compatibility/invitations/:relationshipId",
  compatibilityInvitationCancelRoute,
  deleteCompatibilityInvitation,
);
app.get(
  "/api/compatibility/relationships",
  compatibilityRelationshipsRoute,
  getCompatibilityRelationships,
);
app.get(
  "/api/compatibility/relationships/:relationshipId",
  compatibilityRelationshipRoute,
  getCompatibilityRelationship,
);
app.delete(
  "/api/compatibility/relationships/:relationshipId",
  compatibilityRelationshipEndRoute,
  deleteCompatibilityRelationship,
);
app.get(
  "/api/dev/brain-vector-sync-jobs/failed",
  developmentFailedBrainVectorSyncJobsRoute,
  getDevelopmentFailedBrainVectorSyncJobs,
);
app.post(
  "/api/dev/brain-vector-sync-jobs/reset-failed",
  resetAllDevelopmentBrainVectorSyncJobsRoute,
  postDevelopmentBrainVectorSyncJobsResetAll,
);
app.post(
  "/api/dev/brain-vector-sync-jobs/:jobId/reset",
  resetDevelopmentBrainVectorSyncJobRoute,
  postDevelopmentBrainVectorSyncJobReset,
);
app.get(
  "/api/compatibility/share-consent",
  compatibilityShareConsentRoute,
  getCompatibilityShareConsentContents,
);
app.get(
  "/api/compatibility/share-content",
  compatibilityShareContentRoute,
  getCompatibilityShareContentContents,
);

app.get("/api/diagnoses", diagnosisListRoute, getDiagnoses);
app.get("/api/diagnoses/:diagnosisId", diagnosisDetailRoute, getDiagnosis);
app.get("/api/diagnoses/:diagnosisId/answers", diagnosisAnswersRoute, getDiagnosisAnswerContents);
app.put(
  "/api/diagnoses/:diagnosisId/answers/:diagnosisQuestionId",
  saveDiagnosisAnswerRoute,
  putDiagnosisAnswer,
);
app.put(
  "/api/diagnoses/:diagnosisId/deferred-questions/:diagnosisQuestionId",
  deferDiagnosisQuestionRoute,
  putDiagnosisDeferredQuestion,
);
app.delete("/api/dev/account-data", resetDevelopmentAccountDataRoute, deleteDevelopmentAccountData);

// Web UIの型生成にも使う、機械可読なAPI契約。
app.get("/api/openapi.json", openAPIRouteHandler(app, openApiOptions));

app.get("/", (c) => c.text("me-builder API Server running!"));

export { app };
