// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  endCompatibilityRelationship: vi.fn(),
  fetchCompatibilityRelationship: vi.fn(),
}));

vi.mock("../../infrastructure/compatibility-api", () => mocks);

import { CompatibilityResourceUnavailableError } from "../../model/compatibility-resource-error";
import { useCompatibilityRelationship } from "./use-compatibility-relationship";

describe("useCompatibilityRelationship", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("再接続時は表示中のシートを保ち、取得後に最新状態へ置き換える", async () => {
    const relationshipId = "1".repeat(64);
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.fetchCompatibilityRelationship.mockResolvedValueOnce({
      relationshipId,
      relationshipCategory: "partner",
      status: "waiting",
      nextAction: null,
    });
    let finishRefresh: (value: unknown) => void = () => undefined;
    mocks.fetchCompatibilityRelationship.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        }),
    );
    const { result } = renderHook(() => useCompatibilityRelationship({ relationshipId }));
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    now += 1_000;
    act(() => window.dispatchEvent(new Event("online")));

    await waitFor(() => expect(result.current.isRefreshing).toBe(true));
    expect(result.current.state).toMatchObject({
      status: "success",
      data: { status: "waiting" },
    });

    await act(async () => {
      finishRefresh({
        relationshipId,
        relationshipCategory: "partner",
        status: "ready",
        partner: { displayName: "あおい", aboutMe: { statements: [] }, themes: [] },
        viewer: { displayName: "はる", aboutMe: { statements: [] }, themes: [] },
      });
    });

    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.state).toMatchObject({
      status: "success",
      data: { status: "ready" },
    });
  });

  it("再検証に失敗した場合は古いシートを隠してエラーへ切り替える", async () => {
    const relationshipId = "2".repeat(64);
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.fetchCompatibilityRelationship
      .mockResolvedValueOnce({
        relationshipId,
        relationshipCategory: "family",
        status: "waiting",
        nextAction: null,
      })
      .mockRejectedValueOnce(new CompatibilityResourceUnavailableError("共有は終了しています。"));
    const { result } = renderHook(() => useCompatibilityRelationship({ relationshipId }));
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    now += 1_000;
    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state).toEqual({
      status: "error",
      message: "共有は終了しています。",
    });
    expect(result.current.isRefreshing).toBe(false);
  });

  it("再検証の通信失敗では表示中のシートを維持して再確認を案内する", async () => {
    const relationshipId = "3".repeat(64);
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const readyRelationship = {
      relationshipId,
      relationshipCategory: "friend",
      status: "ready",
      partner: { displayName: "あおい", aboutMe: { statements: [] }, themes: [] },
      viewer: { displayName: "はる", aboutMe: { statements: [] }, themes: [] },
    } as const;
    mocks.fetchCompatibilityRelationship
      .mockResolvedValueOnce(readyRelationship)
      .mockRejectedValueOnce(new TypeError("ネットワークに接続できません"));
    const { result } = renderHook(() => useCompatibilityRelationship({ relationshipId }));
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    now += 1_000;
    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(result.current.refreshError).toBe("ネットワークに接続できません"));
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.state).toEqual({ status: "success", data: readyRelationship });
  });
});
