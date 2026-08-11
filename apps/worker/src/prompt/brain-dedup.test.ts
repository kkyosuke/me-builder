import { describe, expect, it } from "vitest";
import { BRAIN_DEDUP_PROMPT_VERSION, BRAIN_DEDUP_SYSTEM_PROMPT } from "./brain-dedup";

describe("Brain semantic deduplication prompt", () => {
  it("関連しているだけのItemや時点が異なるItemを統合しない", () => {
    expect(BRAIN_DEDUP_SYSTEM_PROMPT).toContain("相互に言い換えられる場合だけ");
    expect(BRAIN_DEDUP_SYSTEM_PROMPT).toContain("時点情報が異なる場合は一致させない");
    expect(BRAIN_DEDUP_SYSTEM_PROMPT).toContain("判断に迷う");
    expect(BRAIN_DEDUP_SYSTEM_PROMPT).toContain("canonical_candidate_index");
  });

  it("追跡可能なprompt versionを持つ", () => {
    expect(BRAIN_DEDUP_PROMPT_VERSION).toMatch(/^brain-dedup-v\d+$/u);
  });
});
