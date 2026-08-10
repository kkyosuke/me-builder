// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fetchAdminStatistics } from "../infrastructure/admin-api";
import { useAdminStatistics } from "./use-admin-statistics";

vi.mock("../infrastructure/admin-api", () => ({ fetchAdminStatistics: vi.fn() }));

const statistics = {
  period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-08T00:00:00.000Z" },
  fetchedAt: "2026-08-08T00:00:00.000Z",
  gemini: {
    status: "available" as const,
    requestCount: 12,
    inputTokens: 0,
    outputTokens: 0,
    accounts: [{ accountId: "account-1", requestCount: 12, inputTokens: 0, outputTokens: 0 }],
  },
  line: {
    status: "available" as const,
    billableMessages: 0,
    monthlyLimit: 5000,
    replyMessages: 3,
  },
};

describe("useAdminStatistics", () => {
  it("LIFFトークンを取得できなければローディングを終了して案内する", async () => {
    const acquireIdToken = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useAdminStatistics(acquireIdToken));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state).toEqual({
      status: "error",
      message: "LINEから管理者画面を開いてください。",
    });
  });

  it("再取得中も取得済みの統計を保持する", async () => {
    vi.mocked(fetchAdminStatistics).mockResolvedValue(statistics);
    let resolveReload: ((token: string | null) => void) | undefined;
    const acquireIdToken = vi
      .fn()
      .mockResolvedValueOnce("initial-token")
      .mockImplementationOnce(
        () =>
          new Promise<string | null>((resolve) => {
            resolveReload = resolve;
          }),
      );
    const { result } = renderHook(() => useAdminStatistics(acquireIdToken));

    await waitFor(() => expect(result.current.state.status).toBe("success"));
    const currentState = result.current.state;

    act(() => {
      void result.current.reload();
    });

    expect(result.current.isRefreshing).toBe(true);
    expect(result.current.state).toBe(currentState);

    await act(async () => resolveReload?.(null));
    expect(result.current.isRefreshing).toBe(false);
  });
});
