// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RelationshipCategoryFilter } from "../../diagnosis/model/relationship-category";
import CompatibilityListApplication from "./compatibility-list-application";

const mocks = vi.hoisted(() => ({
  screenProps: null as null | {
    categoryFilter: RelationshipCategoryFilter;
    onCategoryFilterChange: (filter: RelationshipCategoryFilter) => void;
  },
}));

vi.mock("../../liff", () => ({
  useLiffSession: () => ({ acquireIdToken: vi.fn(), profile: { displayName: "テスト" } }),
}));
vi.mock("./compatibility-list-screen", () => ({
  CompatibilityListScreen: (props: {
    categoryFilter: RelationshipCategoryFilter;
    onCategoryFilterChange: (filter: RelationshipCategoryFilter) => void;
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
    window.history.replaceState({}, "", "/compatibility?category=family&from=test#list");
    render(<CompatibilityListApplication />);

    expect(mocks.screenProps?.categoryFilter).toBe("family");
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
});
