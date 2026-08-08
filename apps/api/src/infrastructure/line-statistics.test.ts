import { describe, expect, it, vi } from "vitest";
import { fetchLineUsage } from "./line-statistics";

describe("fetchLineUsage", () => {
  it("課金対象数・上限と前日までの日別reply成功数を分けて集計する", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/quota")) return Response.json({ type: "limited", value: 5000 });
      if (url.endsWith("/quota/consumption")) return Response.json({ totalUsage: 12 });
      if (url.endsWith("date=20260801")) {
        return Response.json({ status: "ready", success: 8 });
      }
      return Response.json({ status: "unready" });
    });

    const usage = await fetchLineUsage({
      channelAccessToken: "token",
      now: new Date("2026-08-02T03:00:00.000Z"),
      fetcher,
    });

    expect(usage).toEqual({ billableMessages: 12, monthlyLimit: 5000, replyMessages: 8 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher).not.toHaveBeenCalledWith(
      expect.stringContaining("date=20260802"),
      expect.anything(),
    );
  });

  it("月初はreplyの日別APIを呼ばず0件を返す", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/quota")) return Response.json({ type: "limited", value: 5000 });
      if (url.endsWith("/quota/consumption")) return Response.json({ totalUsage: 0 });
      throw new Error(`unexpected URL: ${url}`);
    });

    await expect(
      fetchLineUsage({
        channelAccessToken: "token",
        now: new Date("2026-08-01T03:00:00.000Z"),
        fetcher,
      }),
    ).resolves.toEqual({ billableMessages: 0, monthlyLimit: 5000, replyMessages: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
