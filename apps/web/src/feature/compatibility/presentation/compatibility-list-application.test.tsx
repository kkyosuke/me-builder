// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompatibilityRelationshipCategoryFilter } from "../model/compatibility-category-navigation";
import CompatibilityListApplication from "./compatibility-list-application";

const mocks = vi.hoisted(() => ({
  screenProps: null as null | {
    categoryFilter: CompatibilityRelationshipCategoryFilter;
    onCategoryFilterChange: (filter: CompatibilityRelationshipCategoryFilter) => void;
  },
}));

vi.mock("../../auth", () => ({
  useAuthSession: () => ({
    state: {
      status: "authenticated",
      profile: { displayName: "テスト" },
      role: "user",
      revision: 1,
    },
  }),
}));
vi.mock("./compatibility-list-screen", () => ({
  CompatibilityListScreen: (props: {
    categoryFilter: CompatibilityRelationshipCategoryFilter;
    onCategoryFilterChange: (filter: CompatibilityRelationshipCategoryFilter) => void;
  }) => {
    mocks.screenProps = props;
    return null;
  },
}));
vi.mock("./hooks/use-compatibility-relationships", () => ({
  useCompatibilityRelationships: () => ({
    state: { status: "success", data: { items: [] } },
    operation: { status: "idle" },
    cancellingRelationshipId: null,
    reload: vi.fn(),
    cancel: vi.fn(),
  }),
}));

describe("CompatibilityListApplication category filter", () => {
  afterEach(() => {
    cleanup();
    mocks.screenProps = null;
    window.history.replaceState({}, "", "/compatibility");
    vi.clearAllMocks();
  });

  it("URLから選択を復元し、変更時にcategory queryだけを同期する", () => {
    window.history.replaceState({}, "", "/compatibility?category=general&from=test#list");
    render(<CompatibilityListApplication />);

    expect(mocks.screenProps?.categoryFilter).toBe("all");
    act(() => mocks.screenProps?.onCategoryFilterChange("work"));
    expect(mocks.screenProps?.categoryFilter).toBe("work");
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/compatibility?category=work&from=test#list",
    );

    act(() => mocks.screenProps?.onCategoryFilterChange("all"));
    expect(mocks.screenProps?.categoryFilter).toBe("all");
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/compatibility?from=test#list",
    );
  });

  it("ブラウザの履歴移動時にURLから選択を復元する", () => {
    window.history.replaceState({}, "", "/compatibility?category=partner");
    render(<CompatibilityListApplication />);

    expect(mocks.screenProps?.categoryFilter).toBe("partner");

    act(() => {
      window.history.pushState({}, "", "/compatibility?category=friend");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(mocks.screenProps?.categoryFilter).toBe("friend");

    act(() => {
      window.history.pushState({}, "", "/compatibility?category=unknown");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(mocks.screenProps?.categoryFilter).toBe("all");
  });
});
