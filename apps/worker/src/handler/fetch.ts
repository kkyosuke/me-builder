import { logger, toSafeOperationalErrorFields } from "@me-builder/shared";
import { getWorkerConfig } from "../config";
import type { Env } from "../types";

export async function fetchHandler(req: Request, env: Env): Promise<Response> {
  try {
    const workerConfig = getWorkerConfig(env as unknown as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        status: "ok",
        service: "me-builder-worker",
        environment: workerConfig.environment,
        baseUrl: workerConfig.baseUrl,
        apiUrl: workerConfig.apiUrl,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    // errをそのまま載せると、SDK例外が抱えるrequest/response bodyがlogへ流出しうる。
    logger.error(
      {
        event: "http.request.failed",
        service: "worker",
        path: new URL(req.url).pathname,
        status: 500,
        outcome: "failed",
        ...toSafeOperationalErrorFields(err, {
          code: "WORKER_CONFIGURATION_FAILED",
          category: "configuration",
          stage: "worker.configure",
          retryable: false,
        }),
      },
      "[Worker] fetch handler failed to build a response (unhandled exception)",
    );
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
