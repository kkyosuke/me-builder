// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchProfileSummary,
  requestProfileSummaryGeneration,
} from "../infrastructure/profile-api";
import type { ProfileSummaryReadResult } from "../model/profile-summary";
import { useProfileSummary } from "./use-profile-summary";

vi.mock("../infrastructure/profile-api", () => ({
  fetchProfileSummary: vi.fn(),
  requestProfileSummaryGeneration: vi.fn(),
}));

const summary = {
  generatedAt: "2026-08-12T00:00:00.000Z",
  headline: "今のわたし",
  insights: [],
  recordCount: 1,
  diagnosisCount: 1,
  diaryCount: 0,
  latestRecordedAt: "2026-08-11T00:00:00.000Z",
};

function readResult(
  status: ProfileSummaryReadResult["generation"]["status"],
  versionId = "version-1",
): ProfileSummaryReadResult {
  return {
    summary,
    versions: [
      {
        id: versionId,
        sequence: 1,
        generatedAt: summary.generatedAt,
        isLatest: true,
        generationMethod: "ai",
        summary,
      },
    ],
    availableDataCounts: { diagnosis: 1, diary: 0 },
    generation: {
      status,
      canRegenerate: status === "idle" || status === "failed",
      reasons: ["diagnosis"],
      ...(status === "failed" ? { message: "生成に失敗しました。" } : {}),
    },
    nextAction: "chat",
  };
}

const acquireIdToken = vi.fn().mockResolvedValue("id-token");

describe("useProfileSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquireIdToken.mockResolvedValue("id-token");
    vi.mocked(requestProfileSummaryGeneration).mockResolvedValue({
      generationId: "generation-1",
      status: "queued",
      created: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("生成要求後にAPIの完了状態と新しい版を反映する", async () => {
    const initial = readResult("idle");
    const queued = readResult("queued");
    const generating = readResult("generating");
    const completed = readResult("idle", "version-2");
    vi.mocked(fetchProfileSummary)
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(queued)
      .mockResolvedValueOnce(generating)
      .mockResolvedValueOnce(completed);

    const { result } = renderHook(() => useProfileSummary({ acquireIdToken }));
    await waitFor(() => expect(result.current.state).toEqual({ status: "success", data: initial }));
    vi.useFakeTimers();

    await act(async () => {
      const generation = result.current.generate();
      await vi.advanceTimersByTimeAsync(4_000);
      await generation;
    });

    expect(result.current.state).toEqual({ status: "success", data: completed });
    expect(result.current.generationNotice).toBeNull();
  });

  it("生成失敗をGETの応答から反映する", async () => {
    const initial = readResult("idle");
    const queued = readResult("queued");
    const failed = readResult("failed");
    vi.mocked(fetchProfileSummary)
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(queued)
      .mockResolvedValueOnce(failed);

    const { result } = renderHook(() => useProfileSummary({ acquireIdToken }));
    await waitFor(() => expect(result.current.state.status).toBe("success"));
    vi.useFakeTimers();

    await act(async () => {
      const generation = result.current.generate();
      await vi.advanceTimersByTimeAsync(2_000);
      await generation;
    });

    expect(result.current.state).toEqual({ status: "success", data: failed });
    expect(result.current.generationNotice).toBeNull();
  });

  it("ポーリング上限で生成状態を変更せず再読み込み案内を返す", async () => {
    const initial = readResult("idle");
    const queued = readResult("queued");
    vi.mocked(fetchProfileSummary).mockResolvedValueOnce(initial).mockResolvedValue(queued);

    const { result } = renderHook(() => useProfileSummary({ acquireIdToken }));
    await waitFor(() => expect(result.current.state.status).toBe("success"));
    vi.useFakeTimers();

    await act(async () => {
      const generation = result.current.generate();
      await vi.runAllTimersAsync();
      await generation;
    });

    expect(result.current.state).toEqual({ status: "success", data: queued });
    expect(result.current.generationNotice).toEqual({
      kind: "delayed",
      message:
        "確認に時間がかかっています。生成は続いている可能性があります。最新の状態を再読み込みしてください。",
    });
    expect(fetchProfileSummary).toHaveBeenCalledTimes(41);
  });

  it("POST失敗時はGET由来の生成状態を変更せずエラーを返す", async () => {
    const initial = readResult("idle");
    vi.mocked(fetchProfileSummary).mockResolvedValue(initial);
    vi.mocked(requestProfileSummaryGeneration).mockRejectedValue(
      new Error("まとめの生成を開始できませんでした。"),
    );

    const { result } = renderHook(() => useProfileSummary({ acquireIdToken }));
    await waitFor(() => expect(result.current.state).toEqual({ status: "success", data: initial }));

    await act(async () => {
      await result.current.generate();
    });

    expect(result.current.state).toEqual({ status: "success", data: initial });
    expect(result.current.generationNotice).toEqual({
      kind: "error",
      message: "まとめの生成を開始できませんでした。",
    });
    expect(fetchProfileSummary).toHaveBeenCalledOnce();
  });
});
