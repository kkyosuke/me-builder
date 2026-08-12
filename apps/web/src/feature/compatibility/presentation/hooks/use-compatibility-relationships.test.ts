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
    const acquireIdToken = vi.fn(async () => "id-token");
    const { result } = renderHook(() => useCompatibilityRelationships({ acquireIdToken }));

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
    const acquireIdToken = vi.fn(async () => "id-token");
    const { result } = renderHook(() => useCompatibilityRelationships({ acquireIdToken }));
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
});
