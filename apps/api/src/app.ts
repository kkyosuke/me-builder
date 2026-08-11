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
import { saveDiagnosisAnswerRoute } from "./contract/diagnosis/answer";
import { diagnosisAnswersRoute } from "./contract/diagnosis/answers";
import { deferDiagnosisQuestionRoute } from "./contract/diagnosis/deferred-question";
import { diagnosisDetailRoute } from "./contract/diagnosis/detail";
import { resetDevelopmentDiagnosisDataRoute } from "./contract/diagnosis/dev-reset";
import { diagnosisListRoute } from "./contract/diagnosis/list";
import { liffSessionRoute } from "./contract/line/liff-session";
import { openApiOptions } from "./contract/openapi";
import { profileSummaryGenerationRoute, profileSummaryRoute } from "./contract/profile/summary";
import { InternalServerErrorSchema } from "./contract/shared/errors";
import { getStatistics } from "./controller/admin";
import { getDevelopmentBrainItems, getDevelopmentBrainVector } from "./controller/brain";
import {
  deleteDevelopmentDiagnosisData,
  getDiagnoses,
  getDiagnosis,
  getDiagnosisAnswerContents,
  putDiagnosisAnswer,
  putDiagnosisDeferredQuestion,
} from "./controller/diagnosis";
import { postLiffSession, postLineWebhook } from "./controller/line";
import { getProfileSummaryContents, postProfileSummaryGeneration } from "./controller/profile";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use("*", cors());

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
  const safeError = c.get("safeError");
  const outcome = httpOutcome(status);
  const fields = {
    event: outcome === "failed" ? "http.request.failed" : "http.request.completed",
    service: "api",
    method: c.req.method,
    path: c.req.path,
    status,
    outcome,
    responseTimeMs,
    ...(safeError ?? {}),
  };
  const description = describeHttpResult({
    service: "API",
    method: c.req.method,
    path: c.req.path,
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

// クライアント指定のuserIdではなく、検証済みIDトークンからAccountを解決する。
app.post("/api/line/liff/session", liffSessionRoute, postLiffSession);

app.get("/api/admin/statistics", adminStatisticsRoute, getStatistics);

app.get("/api/profile-summary", profileSummaryRoute, getProfileSummaryContents);
app.post(
  "/api/profile-summary/generations",
  profileSummaryGenerationRoute,
  postProfileSummaryGeneration,
);

app.get("/api/dev/brain-items", developmentBrainItemsRoute, getDevelopmentBrainItems);
app.get(
  "/api/dev/brain-items/:brainItemId/vector",
  developmentBrainVectorRoute,
  getDevelopmentBrainVector,
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
app.delete(
  "/api/dev/diagnosis-data",
  resetDevelopmentDiagnosisDataRoute,
  deleteDevelopmentDiagnosisData,
);

// Web UIの型生成にも使う、機械可読なAPI契約。
app.get("/api/openapi.json", openAPIRouteHandler(app, openApiOptions));

app.get("/", (c) => c.text("me-builder API Server running!"));

export { app };
