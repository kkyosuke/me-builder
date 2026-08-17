// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchDevelopmentBrainItems,
  fetchDevelopmentBrainVector,
} from "../infrastructure/brain-api";
import { useDevelopmentBrainItems } from "./use-development-brain-items";

vi.mock("../infrastructure/brain-api", () => ({
  fetchDevelopmentBrainItems: vi.fn(),
  fetchDevelopmentBrainVector: vi.fn(),
}));

const emptyItems = { items: [], truncated: false };
describe("useDevelopmentBrainItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("session APIが失敗すれば一覧のローディングを終了して案内する", async () => {
    vi.mocked(fetchDevelopmentBrainItems).mockRejectedValue(new Error("session expired"));
    const { result } = renderHook(() => useDevelopmentBrainItems({ enabled: true }));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state).toEqual({ status: "error", message: "session expired" });
  });

  it("Vector確認のsession失効後も再試行できる", async () => {
    vi.mocked(fetchDevelopmentBrainItems).mockResolvedValue(emptyItems);
    vi.mocked(fetchDevelopmentBrainVector)
      .mockRejectedValueOnce(new Error("session expired"))
      .mockResolvedValueOnce({
        state: "missing",
        entryRevision: 1,
        checkedAt: "2026-08-10T00:00:00.000Z",
      });
    const { result } = renderHook(() => useDevelopmentBrainItems({ enabled: true }));
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    await act(async () => {
      await result.current.verifyVector("brain-1");
    });

    expect(result.current.vectorStates["brain-1"]).toEqual({
      status: "error",
      message: "session expired",
    });

    await act(async () => {
      await result.current.verifyVector("brain-1");
    });

    expect(result.current.vectorStates["brain-1"]).toMatchObject({
      status: "success",
      data: { state: "missing" },
    });
    expect(fetchDevelopmentBrainVector).toHaveBeenCalledWith(
      undefined,
      "brain-1",
      expect.any(AbortSignal),
    );
  });
});
