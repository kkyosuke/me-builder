// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchCompatibilityShareContent: vi.fn(),
}));

vi.mock("../../infrastructure/compatibility-api", () => mocks);

import { useCompatibilityShareContent } from "./use-compatibility-share-content";

describe("useCompatibilityShareContent", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("パートナーを初期表示し、取得済みカテゴリへ戻るとキャッシュを使う", async () => {
    mocks.fetchCompatibilityShareContent.mockImplementation(
      (_apiUrl, _idToken, relationshipCategory) =>
        Promise.resolve({
          relationshipCategory,
          aboutMe: null,
          themes: [],
          nextAction: "profile-summary",
        }),
    );
    const acquireIdToken = vi.fn(async () => "id-token");
    const { result } = renderHook(() =>
      useCompatibilityShareContent({
        acquireIdToken,
        latestProfileSummaryVersionId: "summary-version-1",
      }),
    );

    expect(result.current.relationshipCategory).toBe("partner");
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    act(() => result.current.changeRelationshipCategory("family"));
    await waitFor(() => {
      expect(result.current.state).toMatchObject({
        status: "success",
        data: { relationshipCategory: "family" },
      });
    });

    act(() => result.current.changeRelationshipCategory("partner"));
    await waitFor(() => {
      expect(result.current.state).toMatchObject({
        status: "success",
        data: { relationshipCategory: "partner" },
      });
    });

    expect(mocks.fetchCompatibilityShareContent).toHaveBeenCalledTimes(2);
    expect(mocks.fetchCompatibilityShareContent.mock.calls.map((call) => call[2])).toEqual([
      "partner",
      "family",
    ]);
  });

  it("最新のまとめが変わると全カテゴリのキャッシュを破棄する", async () => {
    mocks.fetchCompatibilityShareContent.mockImplementation(
      (_apiUrl, _idToken, relationshipCategory) =>
        Promise.resolve({
          relationshipCategory,
          aboutMe: null,
          themes: [],
          nextAction: "profile-summary",
        }),
    );
    const acquireIdToken = vi.fn(async () => "id-token");
    const { result, rerender } = renderHook(
      ({ latestProfileSummaryVersionId }) =>
        useCompatibilityShareContent({ acquireIdToken, latestProfileSummaryVersionId }),
      { initialProps: { latestProfileSummaryVersionId: "summary-version-1" } },
    );

    await waitFor(() => expect(result.current.state.status).toBe("success"));
    act(() => result.current.changeRelationshipCategory("family"));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: "success",
        data: { relationshipCategory: "family" },
      }),
    );

    rerender({ latestProfileSummaryVersionId: "summary-version-2" });
    await waitFor(() => expect(mocks.fetchCompatibilityShareContent).toHaveBeenCalledTimes(3));

    act(() => result.current.changeRelationshipCategory("partner"));
    await waitFor(() => expect(mocks.fetchCompatibilityShareContent).toHaveBeenCalledTimes(4));
    expect(mocks.fetchCompatibilityShareContent.mock.calls.map((call) => call[2])).toEqual([
      "partner",
      "family",
      "family",
      "partner",
    ]);
  });
});
