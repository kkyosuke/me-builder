import { logger } from "@me-builder/shared";
import { Hono } from "hono";
import { openAPIRouteHandler } from "hono-openapi";
import { cors } from "hono/cors";
import * as v from "valibot";
import { getConfig } from "./config";
import { adminStatisticsRoute } from "./contract/admin/statistics";
import { saveDiagnosisAnswerRoute } from "./contract/diagnosis/answer";
import { diagnosisAnswersRoute } from "./contract/diagnosis/answers";
import { deferDiagnosisQuestionRoute } from "./contract/diagnosis/deferred-question";
import { diagnosisDetailRoute } from "./contract/diagnosis/detail";
import { resetDevelopmentDiagnosisDataRoute } from "./contract/diagnosis/dev-reset";
import { diagnosisListRoute } from "./contract/diagnosis/list";
import { liffSessionRoute } from "./contract/line/liff-session";
import { openApiOptions } from "./contract/openapi";
import { profileSummaryRoute } from "./contract/profile/summary";
import { InternalServerErrorSchema } from "./contract/shared/errors";
import { getStatistics } from "./controller/admin";
import {
  deleteDevelopmentDiagnosisData,
  getDiagnoses,
  getDiagnosis,
  getDiagnosisAnswerContents,
  putDiagnosisAnswer,
  putDiagnosisDeferredQuestion,
} from "./controller/diagnosis";
import { postLiffSession, postLineWebhook } from "./controller/line";
import { getProfileSummaryContents } from "./controller/profile";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use("*", cors());

app.onError((err, c) => {
  logger.error(
    {
      err,
      method: c.req.method,
      path: c.req.path,
    },
    "Unhandled exception in API server",
  );
  return c.json(v.parse(InternalServerErrorSchema, { error: "Internal Server Error" }), 500);
});

app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  logger.info({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    responseTimeMs: ms,
  });
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
