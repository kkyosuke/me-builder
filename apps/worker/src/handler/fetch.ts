import { logger } from "@me-builder/shared";
import { getWorkerConfig } from "../config";
import type { Env } from "../types";

export async function fetchHandler(_req: Request, env: Env): Promise<Response> {
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
    logger.error({ err }, "Unhandled exception in worker fetch handler");
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
