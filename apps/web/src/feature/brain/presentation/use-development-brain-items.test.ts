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
const authenticationError = "本人確認に失敗しました。LINEから開き直してください。";

describe("useDevelopmentBrainItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("LIFFトークンを取得できなければ一覧のローディングを終了して案内する", async () => {
    const acquireIdToken = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() =>
      useDevelopmentBrainItems({ enabled: true, acquireIdToken }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state).toEqual({ status: "error", message: authenticationError });
    expect(fetchDevelopmentBrainItems).not.toHaveBeenCalled();
  });

  it("Vector確認時にLIFFトークンを取得できなくても再試行できる状態に戻す", async () => {
    vi.mocked(fetchDevelopmentBrainItems).mockResolvedValue(emptyItems);
    vi.mocked(fetchDevelopmentBrainVector).mockResolvedValue({
      state: "missing",
      entryRevision: 1,
      checkedAt: "2026-08-10T00:00:00.000Z",
    });
    const acquireIdToken = vi
      .fn()
      .mockResolvedValueOnce("initial-token")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("retry-token");
    const { result } = renderHook(() =>
      useDevelopmentBrainItems({ enabled: true, acquireIdToken }),
    );
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    await act(async () => {
      await result.current.verifyVector("brain-1");
    });

    expect(result.current.vectorStates["brain-1"]).toEqual({
      status: "error",
      message: authenticationError,
    });
    expect(fetchDevelopmentBrainVector).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.verifyVector("brain-1");
    });

    expect(result.current.vectorStates["brain-1"]).toMatchObject({
      status: "success",
      data: { state: "missing" },
    });
    expect(fetchDevelopmentBrainVector).toHaveBeenCalledWith(
      undefined,
      "retry-token",
      "brain-1",
      expect.any(AbortSignal),
    );
  });
});
