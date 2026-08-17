// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelCompatibilityInvitation: vi.fn(),
  fetchCompatibilityRelationships: vi.fn(),
}));

vi.mock("../../infrastructure/compatibility-api", () => mocks);

import { useCompatibilityRelationships } from "./use-compatibility-relationships";

describe("useCompatibilityRelationships", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("取消中のカードIDを公開し、成功後は一覧を再取得せず対象だけを取り除く", async () => {
    const relationshipId = "1".repeat(64);
    mocks.fetchCompatibilityRelationships.mockResolvedValue({
      items: [
        {
          relationshipId,
          status: "pending",
          expiresAt: "2026-08-26T00:00:00.000Z",
          invitationUrl: "https://example.com/invitation",
        },
      ],
    });
    let finishCancellation: () => void = () => undefined;
    mocks.cancelCompatibilityInvitation.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCancellation = resolve;
        }),
    );
    const { result } = renderHook(() => useCompatibilityRelationships());

    await waitFor(() => expect(result.current.state.status).toBe("success"));

    let cancellation: Promise<void> | undefined;
    act(() => {
      cancellation = result.current.cancel(relationshipId);
    });
    await waitFor(() => {
      expect(result.current.cancellingRelationshipId).toBe(relationshipId);
      expect(result.current.state.status).toBe("success");
    });

    await act(async () => {
      finishCancellation();
      await cancellation;
    });

    expect(result.current.cancellingRelationshipId).toBeNull();
    expect(result.current.state).toEqual({ status: "success", data: { items: [] } });
    expect(mocks.fetchCompatibilityRelationships).toHaveBeenCalledOnce();
  });

  it("取消に失敗した場合は対象カードを維持して操作中状態を解除する", async () => {
    const relationshipId = "2".repeat(64);
    mocks.fetchCompatibilityRelationships.mockResolvedValue({
      items: [
        {
          relationshipId,
          status: "pending",
          expiresAt: "2026-08-27T00:00:00.000Z",
          invitationUrl: "https://example.com/invitation",
        },
      ],
    });
    mocks.cancelCompatibilityInvitation.mockRejectedValue(new Error("取消に失敗しました"));
    const { result } = renderHook(() => useCompatibilityRelationships());
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    await act(async () => {
      await result.current.cancel(relationshipId);
    });

    expect(result.current.cancellingRelationshipId).toBeNull();
    expect(result.current.operation).toEqual({
      status: "error",
      message: "取消に失敗しました",
    });
    expect(result.current.state).toMatchObject({
      status: "success",
      data: { items: [{ relationshipId }] },
    });
  });

  it("画面へ戻った時は既存一覧を保ったまま最新の準備状況へ更新する", async () => {
    const relationshipId = "3".repeat(64);
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.fetchCompatibilityRelationships.mockResolvedValueOnce({
      items: [
        {
          relationshipId,
          relationshipCategory: "friend",
          status: "accepted",
          partnerDisplayName: "あおい",
          readiness: { status: "waiting", nextAction: null },
        },
      ],
    });
    let finishRefresh: (value: unknown) => void = () => undefined;
    mocks.fetchCompatibilityRelationships.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        }),
    );
    const { result } = renderHook(() => useCompatibilityRelationships());
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    now += 1_000;
    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(result.current.isRefreshing).toBe(true));
    expect(result.current.state).toMatchObject({
      status: "success",
      data: { items: [{ readiness: { status: "waiting" } }] },
    });

    await act(async () => {
      finishRefresh({
        items: [
          {
            relationshipId,
            relationshipCategory: "friend",
            status: "accepted",
            partnerDisplayName: "あおい",
            readiness: { status: "ready", comparableThemeCount: 2 },
          },
        ],
      });
    });

    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.state).toMatchObject({
      status: "success",
      data: { items: [{ readiness: { status: "ready", comparableThemeCount: 2 } }] },
    });
  });

  it("再検証の通信失敗では表示中の一覧を維持して再確認を案内する", async () => {
    const relationshipId = "4".repeat(64);
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.fetchCompatibilityRelationships
      .mockResolvedValueOnce({
        items: [
          {
            relationshipId,
            relationshipCategory: "partner",
            status: "accepted",
            partnerDisplayName: "あおい",
            readiness: { status: "waiting", nextAction: null },
          },
        ],
      })
      .mockRejectedValueOnce(new TypeError("ネットワークに接続できません"));
    const { result } = renderHook(() => useCompatibilityRelationships());
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    now += 1_000;
    act(() => window.dispatchEvent(new Event("online")));

    await waitFor(() => expect(result.current.refreshError).toBe("ネットワークに接続できません"));
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.state).toMatchObject({
      status: "success",
      data: { items: [{ relationshipId }] },
    });
  });
});
