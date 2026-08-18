import { describe, expect, it } from "vitest";
import { app } from "../index";

const developmentRoutes = [
  { method: "GET", path: "/api/dev/brain-items" },
  { method: "GET", path: "/api/dev/brain-items/brain-1/vector" },
  { method: "GET", path: "/api/dev/brain-vector-sync-jobs/failed" },
  { method: "POST", path: "/api/dev/brain-vector-sync-jobs/job-1/reset" },
  { method: "POST", path: "/api/dev/brain-vector-sync-jobs/reset-failed" },
  { method: "DELETE", path: "/api/dev/account-data" },
] as const;

describe("Production development route isolation E2E", () => {
  it.each(developmentRoutes)(
    "$method $pathを認証処理より前に404へ隠す",
    async ({ method, path }) => {
      const response = await app.request(
        path,
        { method },
        {
          ENVIRONMENT: "production",
          DB: {} as never,
          ACCOUNT_DATA: {} as never,
          CONVERSATION_COORDINATOR: {} as never,
          BRAIN_VECTOR_INDEX: {} as never,
        },
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "Not Found" });
    },
  );
});
