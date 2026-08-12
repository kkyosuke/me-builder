// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fetchCompatibilityShareConsent } from "../../infrastructure/compatibility-api";
import { useCompatibilityShareConsent } from "./use-compatibility-share-consent";

vi.mock("../../infrastructure/compatibility-api", () => ({
  fetchCompatibilityShareConsent: vi.fn(),
}));

const consent = {
  displayName: "うさぎ",
  avatarUrl: null,
  canShare: true,
  blockingReasons: [],
  nextAction: "diagnosis" as const,
};

describe("useCompatibilityShareConsent", () => {
  it("LIFFトークンで共有可否を取得する", async () => {
    vi.mocked(fetchCompatibilityShareConsent).mockResolvedValue(consent);
    const acquireIdToken = vi.fn().mockResolvedValue("id-token");
    const { result } = renderHook(() => useCompatibilityShareConsent({ acquireIdToken }));

    await waitFor(() => expect(result.current.state.status).toBe("success"));
    expect(result.current.state).toEqual({ status: "success", data: consent });
    expect(fetchCompatibilityShareConsent).toHaveBeenCalledWith(
      undefined,
      "id-token",
      expect.anything(),
    );
  });

  it("LIFFトークンを取得できなければ案内を表示する", async () => {
    const acquireIdToken = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useCompatibilityShareConsent({ acquireIdToken }));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state).toEqual({
      status: "error",
      message: "LINEから相性共有画面を開いてください。",
    });
  });
});
