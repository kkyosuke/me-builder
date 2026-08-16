// @vitest-environment jsdom

import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

configure({ asyncUtilTimeout: 5_000 });

const liff = vi.hoisted(() => ({
  initialize: vi.fn(),
  getIdToken: vi.fn(),
}));

vi.mock("../config", () => ({
  config: {
    environment: "production",
    liffId: "test-liff-id",
    apiUrl: "https://api.example.com",
  },
}));
vi.mock("../feature/legal", () => ({
  ServiceTermsGate: ({ children }: { children: ReactNode }) => children,
  ServiceTermsAcceptanceHistory: () => null,
}));
vi.mock("../feature/liff/infrastructure/liff-client", () => ({
  initializeLiff: liff.initialize,
  getLiffIdToken: liff.getIdToken,
}));
vi.mock("../feature/profile", () => ({
  ProfileApplication: () => <main aria-label="わたしのまとめ" />,
}));

function urlOf(input: RequestInfo | URL): URL {
  return input instanceof Request ? new URL(input.url) : new URL(String(input));
}

describe("subscription entitlement user journey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/profile");
    liff.initialize.mockResolvedValue({
      status: "ready",
      inClient: true,
      profile: { displayName: "テスト" },
    });
    liff.getIdToken.mockReturnValue("dummy.id.token");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("年額契約では月次AI枠のリセット日でなく契約の利用可能期限を表示する", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.pathname === "/api/profile") {
        return Response.json({ role: "user", displayName: "テスト", avatar: null });
      }
      if (url.pathname === "/api/profile/entitlement") {
        return Response.json({
          status: "active",
          plan: "full",
          source: "subscription",
          effectiveAt: "2026-08-01T00:00:00.000Z",
          availableUntil: "2027-08-01T00:00:00.000Z",
          aiReply: {
            limit: 600,
            used: 10,
            reserved: 1,
            remaining: 589,
            periodStartsAt: "2026-08-01T00:00:00.000Z",
            resetsAt: "2026-09-01T00:00:00.000Z",
          },
          profileSummary: {
            limit: 12,
            used: 1,
            reserved: 0,
            remaining: 11,
            periodStartsAt: "2026-08-01T00:00:00.000Z",
            resetsAt: "2026-09-01T00:00:00.000Z",
          },
        });
      }
      throw new Error(`Unexpected E2E request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "プロフィール" })).toBeTruthy();
    expect(await screen.findByText("Full")).toBeTruthy();
    expect(screen.getByText("利用可能期限")).toBeTruthy();
    expect(screen.getByText("2027/08/01")).toBeTruthy();
    expect(screen.queryByText("2026/09/01")).toBeNull();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.example.com/api/profile/entitlement",
        expect.objectContaining({ headers: { Authorization: "Bearer dummy.id.token" } }),
      );
    });
  });

  it("Free Planからアップグレード画面をプロフィールより前面に開く", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.pathname === "/api/profile") {
        return Response.json({ role: "user", displayName: "テスト", avatar: null });
      }
      if (url.pathname === "/api/profile/entitlement") {
        return Response.json({
          status: "free",
          plan: "free",
          source: "free",
          effectiveAt: "2026-08-01T00:00:00.000Z",
          availableUntil: null,
          aiReply: {
            limit: 20,
            used: 0,
            reserved: 0,
            remaining: 20,
            periodStartsAt: "2026-08-01T00:00:00.000Z",
            resetsAt: "2026-09-01T00:00:00.000Z",
          },
          profileSummary: {
            limit: 1,
            used: 0,
            reserved: 0,
            remaining: 1,
            periodStartsAt: "2026-08-01T00:00:00.000Z",
            resetsAt: "2026-10-30T00:00:00.000Z",
          },
        });
      }
      if (url.pathname === "/api/billing/plans") {
        return Response.json({
          plans: [
            {
              code: "lite",
              name: "Lite",
              description: "週次の振り返り",
              highlights: ["AI返信 月150回"],
              trialDays: 14,
              prices: [
                { interval: "month", amount: 780, currency: "JPY" },
                { interval: "year", amount: 7_800, currency: "JPY" },
              ],
            },
          ],
        });
      }
      if (url.pathname === "/api/billing/trial-eligibility") {
        return Response.json({ eligible: true, trialDays: 14 });
      }
      throw new Error(`Unexpected E2E request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "プランをアップグレードする" }));

    expect(window.location.pathname).toBe("/profile/billing");
    const billingDialog = await screen.findByRole("dialog", { name: "料金プラン" });
    expect(billingDialog.className).toContain("z-[70]");
    const profileDialog = document.querySelector<HTMLDialogElement>(
      'dialog[aria-labelledby="profile-settings-title"]',
    );
    expect(profileDialog?.getAttribute("aria-hidden")).toBe("true");
    expect(profileDialog?.hasAttribute("inert")).toBe(true);
  });
});
