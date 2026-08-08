import { describe, expect, it, vi } from "vitest";
import { chooseConversationPolicyId } from "./conversation";

const policyIds = ["reflective", "curious", "structured"];

describe("chooseConversationPolicyId", () => {
  it("返信機会がない未試行方針からランダムに選ぶ", () => {
    const random = vi.fn().mockReturnValue(0.99);
    expect(
      chooseConversationPolicyId(
        policyIds,
        [{ policyId: "reflective", replyOpportunityCount: 2, replyCount: 1 }],
        random,
      ),
    ).toBe("structured");
  });

  it("通常は本人の返信率が最も高い方針を選ぶ", () => {
    const random = vi.fn().mockReturnValueOnce(0.9).mockReturnValueOnce(0);
    expect(
      chooseConversationPolicyId(
        policyIds,
        [
          { policyId: "reflective", replyOpportunityCount: 4, replyCount: 1 },
          { policyId: "curious", replyOpportunityCount: 4, replyCount: 3 },
          { policyId: "structured", replyOpportunityCount: 4, replyCount: 2 },
        ],
        random,
      ),
    ).toBe("curious");
  });

  it("20%の探索では実績にかかわらずランダムに選ぶ", () => {
    const random = vi.fn().mockReturnValueOnce(0.1).mockReturnValueOnce(0.99);
    expect(
      chooseConversationPolicyId(
        policyIds,
        [
          { policyId: "reflective", replyOpportunityCount: 4, replyCount: 4 },
          { policyId: "curious", replyOpportunityCount: 4, replyCount: 1 },
          { policyId: "structured", replyOpportunityCount: 4, replyCount: 0 },
        ],
        random,
      ),
    ).toBe("structured");
  });
});
