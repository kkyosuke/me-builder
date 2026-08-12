// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchDiagnosisList: vi.fn() }));

vi.mock("../../infrastructure/diagnosis-api", () => mocks);

import { useDiagnosisList } from "./use-diagnosis-list";

const answeredDiagnosis = {
  id: "diagnosis-1",
  title: "診断",
  description: "説明",
  opensAt: "2026-08-01T00:00:00.000Z",
  closesAt: null,
  displayOrder: 1,
  availability: "open" as const,
  responseStatus: "answered" as const,
  answeredCount: 10,
  questionCount: 10,
  lastAnsweredAt: "2026-08-12T00:00:00.000Z",
};

describe("useDiagnosisList", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("既存データの削除後は一覧を維持したまま再取得する", async () => {
    mocks.fetchDiagnosisList.mockResolvedValueOnce([answeredDiagnosis]);
    let finishReload: (value: unknown) => void = () => undefined;
    mocks.fetchDiagnosisList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReload = resolve;
        }),
    );
    const acquireIdToken = vi.fn(async () => "id-token");
    const { result } = renderHook(() => useDiagnosisList({ acquireIdToken }));

    await waitFor(() => expect(result.current.state.status).toBe("success"));
    await act(async () => undefined);

    let reload: Promise<void> | undefined;
    act(() => {
      reload = result.current.load();
    });
    expect(result.current.state).toEqual({ status: "success", data: [answeredDiagnosis] });
    await waitFor(() => expect(mocks.fetchDiagnosisList).toHaveBeenCalledTimes(2));

    await act(async () => {
      finishReload([
        {
          ...answeredDiagnosis,
          responseStatus: "unanswered",
          answeredCount: 0,
          lastAnsweredAt: null,
        },
      ]);
      await reload;
    });

    expect(result.current.state).toMatchObject({
      status: "success",
      data: [{ responseStatus: "unanswered", answeredCount: 0 }],
    });
  });
});
