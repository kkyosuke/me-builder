// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceTermsAcceptanceHistory } from "./service-terms-acceptance-history";

const mocks = vi.hoisted(() => ({
  fetchHistory: vi.fn(),
}));

vi.mock("../infrastructure/service-terms-api", () => ({
  fetchServiceTermsAcceptanceHistory: mocks.fetchHistory,
}));

describe("ServiceTermsAcceptanceHistory", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("現在有効・過去を区別して本人の全同意履歴を表示する", async () => {
    mocks.fetchHistory.mockResolvedValue([
      {
        documentKey: "terms_of_service",
        version: "2026-08-15-2",
        documentHash: `sha256:${"1".repeat(64)}`,
        acceptedAt: "2026-08-15T03:00:00.000Z",
        status: "current",
      },
      {
        documentKey: "terms_of_service",
        version: "2026-08-15",
        documentHash: `sha256:${"2".repeat(64)}`,
        acceptedAt: "2026-08-15T01:00:00.000Z",
        status: "past",
      },
    ]);

    render(<ServiceTermsAcceptanceHistory />);

    expect(
      screen.getByRole("status", { name: "利用規約の同意履歴を読み込んでいます" }),
    ).toBeTruthy();
    expect(await screen.findByText("version 2026-08-15-2")).toBeTruthy();
    expect(screen.getByText("version 2026-08-15")).toBeTruthy();
    expect(screen.getByText("現在有効")).toBeTruthy();
    expect(screen.getByText("過去の同意")).toBeTruthy();
    expect(screen.getByText(`sha256:${"1".repeat(64)}`)).toBeTruthy();
    expect(mocks.fetchHistory).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
  });

  it("履歴取得だけを再試行できる", async () => {
    mocks.fetchHistory
      .mockRejectedValueOnce(new Error("同意履歴を取得できませんでした。"))
      .mockResolvedValueOnce([]);

    render(<ServiceTermsAcceptanceHistory />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "同意履歴を取得できませんでした",
    );
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));

    await waitFor(() => expect(mocks.fetchHistory).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("同意履歴はありません。")).toBeTruthy();
  });
});
