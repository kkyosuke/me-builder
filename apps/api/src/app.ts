import { logger } from "@me-builder/shared";
import { Hono } from "hono";
import { openAPIRouteHandler } from "hono-openapi";
import { cors } from "hono/cors";
import * as v from "valibot";
import { getConfig } from "./config";
import { liffSessionRoute } from "./contract/line/liff-session";
import { openApiOptions } from "./contract/openapi";
import { InternalServerErrorSchema } from "./contract/shared/errors";
import { saveSurveyAnswerRoute } from "./contract/survey/answer";
import { surveyAnswersRoute } from "./contract/survey/answers";
import { surveyDetailRoute } from "./contract/survey/detail";
import { surveyListRoute } from "./contract/survey/list";
import { postLiffSession, postLineWebhook } from "./controller/line";
import {
  getSurvey,
  getSurveyAnswerContents,
  getSurveys,
  putSurveyAnswer,
} from "./controller/survey";
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

app.get("/api/surveys", surveyListRoute, getSurveys);
app.get("/api/surveys/:surveyId", surveyDetailRoute, getSurvey);
app.get("/api/surveys/:surveyId/answers", surveyAnswersRoute, getSurveyAnswerContents);
app.put("/api/surveys/:surveyId/answers/:surveyQuestionId", saveSurveyAnswerRoute, putSurveyAnswer);

// Web UIの型生成にも使う、機械可読なAPI契約。
app.get("/api/openapi.json", openAPIRouteHandler(app, openApiOptions));

app.get("/", (c) => c.text("me-builder API Server running!"));

export { app };
