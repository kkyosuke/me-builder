import { describe, expect, it } from "vitest";
import {
  VERTEX_AUTHORIZATION_KEY_SERVICE,
  authorizationKeyPolicyRule,
} from "./gcp-authorization-key-policy";

describe("authorizationKeyPolicyRule", () => {
  it("runtime credential無効時はservice accountへのAPI key bindingをすべて拒否する", () => {
    expect(authorizationKeyPolicyRule(false)).toEqual({ enforce: "TRUE" });
  });

  it("runtime credential有効時もVertex AI以外へのbindingを許可しない", () => {
    const rule = authorizationKeyPolicyRule(true);

    expect(rule.enforce).toBe("TRUE");
    expect(JSON.parse(rule.parameters ?? "")).toEqual({
      allowedServices: [VERTEX_AUTHORIZATION_KEY_SERVICE],
    });
  });
});
