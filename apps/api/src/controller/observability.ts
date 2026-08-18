import { type WebClientErrorReport, logger } from "@me-builder/shared";
import type { Context } from "hono";
import * as v from "valibot";
import { getConfig } from "../config";
import { WebClientErrorReportSchema } from "../contract/observability/web-client-error";
import { ForbiddenErrorSchema } from "../contract/shared/errors";
import { authenticatedActor } from "../middleware/authentication";
import type { AppEnv } from "../types";

const MAX_WEB_CLIENT_ERROR_BODY_BYTES = 4_096;

type LimitedBody = { body: string; tooLarge: false } | { tooLarge: true };

/** Content-Lengthを信頼せず、上限を超えた時点でrequest streamを打ち切る。 */
export async function readLimitedTextBody(
  request: Request,
  maxBytes: number,
): Promise<LimitedBody> {
  const reader = request.body?.getReader();
  if (!reader) return { body: "", tooLarge: false };
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = "";
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytesRead += result.value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { tooLarge: true };
      }
      body += decoder.decode(result.value, { stream: true });
    }
    body += decoder.decode();
    return { body, tooLarge: false };
  } finally {
    reader.releaseLock();
  }
}

function errorFingerprint(report: WebClientErrorReport): string {
  return [
    report.kind,
    report.errorType,
    report.route,
    report.release,
    report.sourceFile ?? "unknown",
    report.sourceLine ?? 0,
    report.sourceColumn ?? 0,
    report.operation ?? "unknown",
    report.operationErrorCode ?? "unknown",
    report.operationStatus ?? 0,
  ].join(":");
}

function describeWebClientError(report: WebClientErrorReport): string {
  const result = report.recovered ? "recovered" : "failed";
  return `[Web] ${report.kind} at ${report.route} -> ${result}`;
}

export async function postWebClientError(c: Context<AppEnv>): Promise<Response> {
  const config = getConfig(c.env);
  const origin = c.req.header("Origin");
  if (!config.webOrigin || origin !== config.webOrigin) {
    return c.json(v.parse(ForbiddenErrorSchema, { error: "Forbidden" }), 403);
  }

  const contentLength = Number(c.req.header("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_WEB_CLIENT_ERROR_BODY_BYTES) {
    return c.body(null, 413);
  }

  const limiter = c.env.WEB_ERROR_RATE_LIMITER;
  const accountId = authenticatedActor(c).accountId;
  if (limiter && !(await limiter.limit({ key: `account:${accountId}` })).success) {
    return c.body(null, 429);
  }

  const bodyResult = await readLimitedTextBody(c.req.raw, MAX_WEB_CLIENT_ERROR_BODY_BYTES);
  if (bodyResult.tooLarge) return c.body(null, 413);
  const rawBody = bodyResult.body;

  let input: unknown;
  try {
    input = JSON.parse(rawBody);
  } catch {
    return c.body(null, 400);
  }
  const parsed = v.safeParse(WebClientErrorReportSchema, input);
  if (!parsed.success) return c.body(null, 400);

  const output = parsed.output;
  const report: WebClientErrorReport = {
    schemaVersion: output.schemaVersion,
    kind: output.kind,
    route: output.route,
    release: output.release,
    errorType: output.errorType,
    ...(output.sourceFile !== undefined ? { sourceFile: output.sourceFile } : {}),
    ...(output.sourceLine !== undefined ? { sourceLine: output.sourceLine } : {}),
    ...(output.sourceColumn !== undefined ? { sourceColumn: output.sourceColumn } : {}),
    ...(output.operation !== undefined ? { operation: output.operation } : {}),
    ...(output.operationErrorCode !== undefined
      ? { operationErrorCode: output.operationErrorCode }
      : {}),
    ...(output.operationStatus !== undefined ? { operationStatus: output.operationStatus } : {}),
    online: output.online,
    recovered: output.recovered,
  };
  const fields = {
    event: report.recovered ? "web.client.recovered" : "web.client.failed",
    service: "web",
    environment: config.environment,
    outcome: report.recovered ? "degraded" : "failed",
    stage: "browser.runtime",
    errorCode: report.recovered ? "WEB_CLIENT_ERROR_RECOVERED" : "WEB_CLIENT_ERROR",
    errorCategory: "client",
    retryable: false,
    fingerprint: errorFingerprint(report),
    ...report,
  };
  const description = describeWebClientError(report);
  if (report.recovered) logger.warn(fields, description);
  else logger.error(fields, description);

  // 受理したブラウザイベントがこのrequestの終端ログになる。
  c.set("terminalLogOwnedByRoute", true);
  c.header("Cache-Control", "no-store");
  return c.body(null, 204);
}
