import { describe, expect, it } from "vitest";
import {
  PROFILE_HISTORY_STATE_KEY,
  PROFILE_RETURN_PATHNAME_STATE_KEY,
  historyProfileReturnPathname,
  historyProfileView,
  resolveProfileView,
} from "./profile-navigation";

describe("profile navigation", () => {
  it.each([
    ["/profile", "production", "profile"],
    ["/profile/avatar", "production", "avatar"],
    ["/profile/photos", "production", "photos"],
    ["/profile/personal-data", "preview", "personal-data"],
    ["/profile/brain-items", "local", "brain-items"],
    ["/profile/personal-data", "production", "profile"],
    ["/diagnosis", "production", "closed"],
  ] as const)("%sを環境境界に従って%sへ解決する", (pathname, environment, expected) => {
    expect(resolveProfileView(pathname, environment)).toBe(expected);
  });

  it.each([
    "/profile-old",
    "/profile/avatar/extra",
    "/profile/photos/entry",
    "/profile/photos/entry/extra",
    "/profile/billing-old",
    "/profile/unknown",
  ])("未定義のprefix衝突%sをprofileとして扱わない", (pathname) => {
    expect(resolveProfileView(pathname, "production")).toBe("closed");
  });

  it("History stateから許可済みのviewと復帰pathだけを復元する", () => {
    const state = {
      [PROFILE_HISTORY_STATE_KEY]: "billing",
      [PROFILE_RETURN_PATHNAME_STATE_KEY]: "/diagnosis",
    };
    expect(historyProfileView(state)).toBe("billing");
    expect(historyProfileReturnPathname(state)).toBe("/diagnosis");
    expect(historyProfileView({ [PROFILE_HISTORY_STATE_KEY]: "admin" })).toBeNull();
    expect(
      historyProfileReturnPathname({ [PROFILE_RETURN_PATHNAME_STATE_KEY]: "https://evil.test" }),
    ).toBeNull();
  });
});
