// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAdminStatistics } from "./use-admin-statistics";

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
});
