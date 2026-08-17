import { describe, expect, it } from "vitest";
import { createSsoRolloutAuthorizer, ssoRolloutBucket } from "./sso-rollout";

describe("SSO production rollout", () => {
  it("0%では管理者だけ、100%ではlink済み一般Accountも対象にする", async () => {
    const admin = { accountId: "admin-account", role: "admin" as const };
    const user = { accountId: "user-account", role: "user" as const };

    await expect(createSsoRolloutAuthorizer(0).allows(admin)).resolves.toBe(true);
    await expect(createSsoRolloutAuthorizer(0).allows(user)).resolves.toBe(false);
    await expect(createSsoRolloutAuthorizer(100).allows(user)).resolves.toBe(true);
  });

  it("同じAccountを再deploy後も同じ匿名bucketへ配置する", async () => {
    const first = await ssoRolloutBucket("stable-account-id");
    const second = await ssoRolloutBucket("stable-account-id");

    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(100);
    expect(second).toBe(first);
  });

  it("範囲外や小数の割合を起動前に拒否する", () => {
    expect(() => createSsoRolloutAuthorizer(-1)).toThrow();
    expect(() => createSsoRolloutAuthorizer(101)).toThrow();
    expect(() => createSsoRolloutAuthorizer(1.5)).toThrow();
  });
});
