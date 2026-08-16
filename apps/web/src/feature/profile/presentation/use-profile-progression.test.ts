// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchProfileProgression: vi.fn() }));

vi.mock("../infrastructure/progression-api", () => mocks);

import { useProfileProgression } from "./use-profile-progression";

const progression = {
  level: 2,
  growthValue: 7,
  currentLevelThreshold: 5,
  nextLevelThreshold: 20,
  collectedPieces: 2,
  activePieces: 2,
  categoryCount: 2,
  calculationVersion: 1,
  highestLevel: 2,
  isProcessing: false,
  recentChanges: [],
  milestoneCards: [],
};

describe("useProfileProgression", () => {
  afterEach(() => {
    cleanup();
    mocks.fetchProfileProgression.mockReset();
  });

  it("診断完了後は既存値を残して処理中へ移り、確定値で更新する", async () => {
    mocks.fetchProfileProgression.mockResolvedValue(progression);
    const { result } = renderHook(() => useProfileProgression());
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    let finishReload: (value: typeof progression) => void = () => undefined;
    mocks.fetchProfileProgression.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReload = resolve;
        }),
    );

    let reload: Promise<void> | undefined;
    act(() => {
      reload = result.current.reload({ expectProcessing: true });
    });
    expect(result.current.state).toMatchObject({
      status: "success",
      data: { level: 2, isProcessing: true },
    });
    await waitFor(() => expect(mocks.fetchProfileProgression).toHaveBeenCalledTimes(2));

    await act(async () => {
      finishReload({ ...progression, level: 3, growthValue: 20 });
      await reload;
    });
    expect(result.current.state).toMatchObject({
      status: "success",
      data: { level: 3, isProcessing: false },
    });
  });

  it("session APIが失敗してもloadingのままにしない", async () => {
    mocks.fetchProfileProgression.mockRejectedValue(new Error("session expired"));
    const { result } = renderHook(() => useProfileProgression());

    await waitFor(() => expect(result.current.state.status).toBe("error"));
  });
});
