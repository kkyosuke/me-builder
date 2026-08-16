// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fetchAdminAccounts } from "../infrastructure/admin-api";
import { useAdminAccounts } from "./use-admin-accounts";

vi.mock("../infrastructure/admin-api", () => ({ fetchAdminAccounts: vi.fn() }));

const firstPage = {
  accounts: [],
  total: 2,
  nextCursor: "next-cursor",
};

describe("useAdminAccounts", () => {
  it("cursorで次ページへ進み、前ページへ戻る", async () => {
    vi.mocked(fetchAdminAccounts).mockResolvedValue(firstPage);
    const { result } = renderHook(() => useAdminAccounts());

    await waitFor(() => expect(result.current.state.status).toBe("success"));
    expect(fetchAdminAccounts).toHaveBeenLastCalledWith(
      undefined,
      expect.objectContaining({ sort: "created" }),
      undefined,
      expect.any(AbortSignal),
    );

    act(() => result.current.nextPage());
    await waitFor(() => expect(result.current.pageNumber).toBe(2));
    await waitFor(() =>
      expect(fetchAdminAccounts).toHaveBeenLastCalledWith(
        undefined,
        expect.objectContaining({ sort: "created" }),
        "next-cursor",
        expect.any(AbortSignal),
      ),
    );

    act(() => result.current.previousPage());
    await waitFor(() => expect(result.current.pageNumber).toBe(1));
  });

  it("絞り込み変更時は先頭ページから再取得する", async () => {
    vi.mocked(fetchAdminAccounts).mockResolvedValue(firstPage);
    const { result } = renderHook(() => useAdminAccounts());
    await waitFor(() => expect(result.current.state.status).toBe("success"));
    act(() => result.current.nextPage());
    await waitFor(() => expect(result.current.pageNumber).toBe(2));

    act(() => result.current.updateFilter("role", "admin"));
    await waitFor(() => expect(result.current.pageNumber).toBe(1));
    await waitFor(() =>
      expect(fetchAdminAccounts).toHaveBeenLastCalledWith(
        undefined,
        expect.objectContaining({ role: "admin" }),
        undefined,
        expect.any(AbortSignal),
      ),
    );
  });
});
