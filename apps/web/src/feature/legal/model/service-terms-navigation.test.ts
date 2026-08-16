import { describe, expect, it } from "vitest";
import { serviceTermsAcceptanceDestination } from "./service-terms-navigation";

describe("serviceTermsAcceptanceDestination", () => {
  it.each(["/", "/app", "/terms"])("%sに復帰先がなければわたし画面を返す", (path) => {
    expect(serviceTermsAcceptanceDestination(path)).toBe("/me");
  });

  it("本人向け機能の直接リンクはqueryとhashを含めて保つ", () => {
    const location = "/compatibility/invitations/relationship-id?from=line#consent";

    expect(serviceTermsAcceptanceDestination(location)).toBe(location);
  });
});
