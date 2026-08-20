import { describe, expect, it, vi } from "vitest";
import { app } from "./app";

describe("API readiness", () => {
  it("D1へ接続できるときだけreadyを返す", async () => {
    const first = vi.fn().mockResolvedValue({ ready: 1 });
    const prepare = vi.fn(() => ({ first }));

    const response = await app.request("/api/ready", {}, { DB: { prepare } as never });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ status: "ready" });
    expect(prepare).toHaveBeenCalledWith("SELECT 1 AS ready");
    expect(first).toHaveBeenCalledOnce();
  });

  it("D1 binding不足と接続失敗を依存先の詳細なしで503にする", async () => {
    const missing = await app.request("/api/ready");
    const failed = await app.request(
      "/api/ready",
      {},
      {
        DB: {
          prepare: () => ({ first: vi.fn().mockRejectedValue(new Error("private D1 detail")) }),
        } as never,
      },
    );

    for (const response of [missing, failed]) {
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ status: "unavailable" });
    }
  });
});
