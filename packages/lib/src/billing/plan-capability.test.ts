import { describe, expect, it } from "vitest";
import capabilityCatalog from "./capability-catalog.json";
import {
  getPlanCapabilityComparison,
  resolvePlanCapabilityValues,
  validatePlanCapabilityConfiguration,
} from "./plan-capability";
import planCapabilityMapping from "./plan-capability-mapping.json";

describe("Plan capability catalog", () => {
  it.each([
    ["free", 20, 1, 30, false, 0, 1],
    ["lite", 150, 4, 365, true, 1, 1],
    ["full", 600, 12, null, true, 5, 1],
    ["family", 600, 12, null, true, 5, 4],
  ] as const)(
    "%sの機能値をPlanマッピングから解決する",
    (plan, aiLimit, summaryLimit, searchDays, weeklyReflection, relationships, seats) => {
      expect(resolvePlanCapabilityValues(plan)).toMatchObject({
        aiReply: { limit: aiLimit },
        profileSummary: { limit: summaryLimit },
        semanticSearchDays: searchDays,
        weeklyReflection,
        concurrentRelationshipLimit: relationships,
        accountSeatLimit: seats,
      });
    },
  );

  it("意味検索の選択肢をPlanとは独立したマスタとして保持する", () => {
    expect(capabilityCatalog.capabilities["semantic-search"].options).toMatchObject({
      "30-days": { value: 30 },
      "90-days": { value: 90 },
      "one-year": { value: 365 },
      unlimited: { value: null },
    });
  });

  it("解決したquotaを共有設定から切り離して不変にする", () => {
    const first = resolvePlanCapabilityValues("full");
    const second = resolvePlanCapabilityValues("full");

    expect(Object.isFrozen(first.aiReply)).toBe(true);
    expect(Object.isFrozen(first.profileSummary)).toBe(true);
    expect(first.profileSummary).not.toBe(second.profileSummary);
    expect(second.profileSummary).toEqual({ limit: 12, period: "assignment-month" });
  });

  it("公開表示も実行時と同じPlanマッピングから解決する", () => {
    const comparison = getPlanCapabilityComparison();
    const semanticSearch = comparison.capabilities.find(({ id }) => id === "semantic-search");

    expect(comparison.plans.map(({ displayName }) => displayName)).toEqual([
      "Free",
      "Lite",
      "Full",
      "ファミリーパック",
    ]);
    expect(semanticSearch?.plans).toEqual({
      free: { optionId: "30-days", display: "直近30日" },
      lite: { optionId: "one-year", display: "直近1年" },
      full: { optionId: "unlimited", display: "保存されている全期間" },
      family: { optionId: "unlimited-per-account", display: "1 AccountごとにFullと同じ" },
    });
    const aiReply = comparison.capabilities.find(({ id }) => id === "ai-reply");
    const relationshipContext = comparison.capabilities.find(
      ({ id }) => id === "relationship-question-context",
    );
    expect(aiReply?.plans.family.display).toBe("1 Accountあたり月600回");
    expect(relationshipContext?.plans.family.display).toContain("参加者の非共有情報は利用しない");
  });

  it("機能の割当漏れと存在しないoptionを設定エラーにする", () => {
    const missing = structuredClone(planCapabilityMapping) as unknown as {
      plans: { lite: { capabilities: Record<string, string> } };
    };
    missing.plans.lite.capabilities = Object.fromEntries(
      Object.entries(missing.plans.lite.capabilities).filter(([id]) => id !== "semantic-search"),
    );
    expect(() => validatePlanCapabilityConfiguration(capabilityCatalog, missing)).toThrow(
      "plan lite must map every known key exactly once",
    );

    const unknown = structuredClone(planCapabilityMapping) as unknown as {
      plans: { lite: { capabilities: Record<string, string> } };
    };
    unknown.plans.lite.capabilities["semantic-search"] = "unknown";
    expect(() => validatePlanCapabilityConfiguration(capabilityCatalog, unknown)).toThrow(
      "Plan lite selects an unknown option for semantic-search",
    );

    const inherited = structuredClone(planCapabilityMapping) as unknown as {
      plans: { lite: { capabilities: Record<string, string> } };
    };
    inherited.plans.lite.capabilities["semantic-search"] = "toString";
    expect(() => validatePlanCapabilityConfiguration(capabilityCatalog, inherited)).toThrow(
      "Plan lite selects an unknown option for semantic-search",
    );
  });

  it("機能kindに合わない値を設定エラーにする", () => {
    const invalid = structuredClone(capabilityCatalog) as unknown as {
      capabilities: {
        "semantic-search": { options: { "90-days": { value: number } } };
      };
    };
    invalid.capabilities["semantic-search"].options["90-days"].value = -90;

    expect(() => validatePlanCapabilityConfiguration(invalid, planCapabilityMapping)).toThrow(
      "Capability semantic-search option 90-days has an invalid value",
    );
  });
});
