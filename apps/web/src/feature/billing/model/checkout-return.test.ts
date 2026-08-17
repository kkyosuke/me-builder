// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { ProfileEntitlement } from "../../profile-settings/model/entitlement";
import { waitForSubscriptionProjection } from "./checkout-return";

const entitlement = (source: ProfileEntitlement["source"]): ProfileEntitlement => ({
  status: source === "subscription" ? "active" : "free",
  plan: source === "subscription" ? "lite" : "free",
  source,
  effectiveAt: "2026-08-16T00:00:00.000Z",
  availableUntil: source === "subscription" ? "2026-09-16T00:00:00.000Z" : null,
  aiReply: {
    limit: 20,
    used: 0,
    reserved: 0,
    remaining: 20,
    periodStartsAt: "2026-08-16T00:00:00.000Z",
    resetsAt: "2026-09-16T00:00:00.000Z",
  },
  profileSummary: {
    limit: 4,
    used: 0,
    reserved: 0,
    remaining: 4,
    periodStartsAt: "2026-08-16T00:00:00.000Z",
    resetsAt: "2026-09-16T00:00:00.000Z",
  },
});

describe("waitForSubscriptionProjection", () => {
  it("queryだけで成功にせずsubscription projectionを待つ", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(entitlement("free"))
      .mockResolvedValueOnce(entitlement("subscription"));
    await expect(
      waitForSubscriptionProjection(fetcher, {
        signal: new AbortController().signal,
        intervalMs: 0,
      }),
    ).resolves.toMatchObject({ plan: "lite", source: "subscription" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("期限内に反映されなければ待機案内を返す", async () => {
    await expect(
      waitForSubscriptionProjection(vi.fn().mockResolvedValue(entitlement("free")), {
        signal: new AbortController().signal,
        attempts: 2,
        intervalMs: 0,
      }),
    ).rejects.toThrow("契約の反映に時間がかかっています");
  });
});
