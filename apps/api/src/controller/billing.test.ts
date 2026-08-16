import { describe, expect, it } from "vitest";
import { app } from "../app";

describe("billing plan catalog", () => {
  it("認証なしで公開可能なPlan名と税込価格だけを返す", async () => {
    const response = await app.request("/api/billing/plans");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      plans: [
        { code: "lite", prices: [{ amount: 780 }, { amount: 7_800 }] },
        { code: "full", prices: [{ amount: 1_480 }, { amount: 14_800 }] },
        { code: "family", prices: [{ amount: 2_980 }, { amount: 29_800 }] },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/lookupKey|price_|productId/i);
  });
});
