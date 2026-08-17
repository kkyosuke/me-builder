// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileEntitlement } from "../feature/profile-settings/model/entitlement";

const mocks = vi.hoisted(() => ({
  fetchPlans: vi.fn(),
  createCheckout: vi.fn(),
  verifyCheckout: vi.fn(),
  fetchEntitlement: vi.fn(),
  fetchTrialEligibility: vi.fn(),
  createPortal: vi.fn(),
  createPlanChange: vi.fn(),
  openLiffWindow: vi.fn(),
}));

vi.mock("../feature/billing/infrastructure/billing-api", () => ({
  fetchBillingPlanCatalog: mocks.fetchPlans,
  createCheckoutSession: mocks.createCheckout,
  verifyCheckoutSessionCompletion: mocks.verifyCheckout,
  fetchBillingTrialEligibility: mocks.fetchTrialEligibility,
  createCustomerPortalSession: mocks.createPortal,
  createPlanChangeSession: mocks.createPlanChange,
}));
vi.mock("../feature/profile-settings/infrastructure/entitlement-api", () => ({
  fetchProfileEntitlement: mocks.fetchEntitlement,
}));
vi.mock("../feature/liff/infrastructure/liff-client", () => ({
  openLiffWindow: mocks.openLiffWindow,
}));
import BillingPlanApplication from "../feature/billing/presentation/billing-plan-application";

const plan = {
  code: "lite" as const,
  name: "Lite",
  description: "週次の振り返り",
  highlights: ["AI返信 月150回"],
  trialDays: null,
  prices: [
    { interval: "month" as const, amount: 780, currency: "JPY" as const },
    { interval: "year" as const, amount: 7_800, currency: "JPY" as const },
  ],
};

const entitlement = (source: ProfileEntitlement["source"]): ProfileEntitlement => ({
  status: source === "subscription" ? "active" : "free",
  plan: source === "subscription" ? "lite" : "free",
  source,
  effectiveAt: "2026-08-16T00:00:00.000Z",
  availableUntil: source === "subscription" ? "2026-09-16T00:00:00.000Z" : null,
  aiReply: {
    limit: source === "subscription" ? 150 : 20,
    used: 0,
    reserved: 0,
    remaining: source === "subscription" ? 150 : 20,
    periodStartsAt: "2026-08-16T00:00:00.000Z",
    resetsAt: "2026-09-16T00:00:00.000Z",
  },
  profileSummary: {
    limit: source === "subscription" ? 4 : 1,
    used: 0,
    reserved: 0,
    remaining: source === "subscription" ? 4 : 1,
    periodStartsAt: "2026-08-16T00:00:00.000Z",
    resetsAt: "2026-09-16T00:00:00.000Z",
  },
});

describe("billing purchase user journey", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/profile/billing");
    mocks.fetchPlans.mockReset().mockResolvedValue([plan]);
    mocks.createCheckout.mockReset().mockResolvedValue("https://checkout.stripe.test/session");
    mocks.verifyCheckout.mockReset().mockResolvedValue(undefined);
    mocks.fetchEntitlement.mockReset().mockResolvedValue(entitlement("free"));
    mocks.fetchTrialEligibility.mockReset().mockResolvedValue(true);
    mocks.createPortal.mockReset().mockResolvedValue("https://billing.stripe.test/portal");
    mocks.createPlanChange.mockReset().mockResolvedValue("https://billing.stripe.test/plan-change");
    mocks.openLiffWindow.mockReset().mockReturnValue(true);
  });
  afterEach(cleanup);

  it("プランを確認してStripe Checkoutへ遷移する", async () => {
    const navigate = vi.fn();
    render(<BillingPlanApplication onBack={vi.fn()} navigateToCheckout={navigate} />);

    await screen.findByRole("radio", { name: "ノーマル Lite" });
    fireEvent.click(screen.getByRole("button", { name: /プランを変更する/ }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("https://checkout.stripe.test/session"),
    );
    expect(mocks.createCheckout).toHaveBeenCalledWith(
      undefined,
      { plan: "lite", interval: "month" },
      expect.any(AbortSignal),
    );
  });

  it("LIFFブラウザではCheckoutをLINEのアプリ内ブラウザで開き再表示導線を残す", async () => {
    render(<BillingPlanApplication onBack={vi.fn()} />);

    await screen.findByRole("radio", { name: "ノーマル Lite" });
    fireEvent.click(screen.getByRole("button", { name: /プランを変更する/ }));

    await waitFor(() =>
      expect(mocks.openLiffWindow).toHaveBeenCalledWith("https://checkout.stripe.test/session"),
    );
    expect(
      screen.getByRole("link", { name: "こちらからStripeを開いてください" }).getAttribute("href"),
    ).toBe("https://checkout.stripe.test/session");
  });

  it("Checkout復帰後はprojectionが反映されてから購入完了を表示する", async () => {
    window.history.replaceState(
      {},
      "",
      "/profile/billing?billing=checkout-return&session_id=cs_test_completed",
    );
    mocks.fetchEntitlement
      .mockResolvedValueOnce(entitlement("free"))
      .mockResolvedValueOnce(entitlement("subscription"));
    const onEntitlementChanged = vi.fn();

    render(
      <BillingPlanApplication
        onBack={vi.fn()}
        onEntitlementChanged={onEntitlementChanged}
        projectionPollIntervalMs={0}
      />,
    );

    expect(await screen.findByText("Liteが利用できるようになりました。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "契約を管理" })).toBeTruthy();
    expect(onEntitlementChanged).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "lite", source: "subscription" }),
    );
    expect(mocks.verifyCheckout).toHaveBeenCalledWith(
      undefined,
      "cs_test_completed",
      expect.any(AbortSignal),
    );
  });

  it("Checkout復帰後にカタログ取得だけ失敗しても反映済みの購入完了を表示する", async () => {
    window.history.replaceState(
      {},
      "",
      "/profile/billing?billing=checkout-return&session_id=cs_test_completed",
    );
    mocks.fetchPlans.mockRejectedValueOnce(new Error("catalog unavailable"));
    mocks.fetchEntitlement.mockResolvedValueOnce(entitlement("subscription"));
    const onEntitlementChanged = vi.fn();

    render(
      <BillingPlanApplication
        onBack={vi.fn()}
        onEntitlementChanged={onEntitlementChanged}
        projectionPollIntervalMs={0}
      />,
    );

    expect(await screen.findByText("Liteが利用できるようになりました。")).toBeTruthy();
    expect(onEntitlementChanged).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "lite", source: "subscription" }),
    );
  });

  it("本人のCheckout完了を確認できない復帰URLでは購入完了にしない", async () => {
    window.history.replaceState({}, "", "/profile/billing?billing=checkout-return");

    render(<BillingPlanApplication onBack={vi.fn()} projectionPollIntervalMs={0} />);

    expect(await screen.findAllByText(/購入結果を確認できませんでした/)).toHaveLength(2);
    expect(mocks.fetchEntitlement).not.toHaveBeenCalled();
  });

  it("契約中は選択した変更内容をStripe Portalで確認する", async () => {
    mocks.fetchEntitlement.mockResolvedValue(entitlement("subscription"));
    const navigate = vi.fn();
    render(<BillingPlanApplication onBack={vi.fn()} navigateToCheckout={navigate} />);

    fireEvent.click(await screen.findByRole("radio", { name: "年額" }));
    fireEvent.click(screen.getByRole("button", { name: "プランを変更する" }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("https://billing.stripe.test/plan-change"),
    );
    expect(mocks.createPlanChange).toHaveBeenCalledWith(
      undefined,
      { plan: "lite", interval: "year" },
      expect.any(AbortSignal),
    );
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("下位Planはアプリで期間末変更を確認して予約する", async () => {
    mocks.fetchEntitlement.mockResolvedValue({
      ...entitlement("subscription"),
      plan: "full",
    });
    mocks.createPlanChange.mockResolvedValue(
      "https://app.example.test/profile/billing?billing=change-scheduled&plan=lite&effective_at=2026-09-01T00%3A00%3A00.000Z",
    );
    const navigate = vi.fn();
    render(<BillingPlanApplication onBack={vi.fn()} navigateToCheckout={navigate} />);

    await screen.findByRole("radio", { name: "ノーマル Lite" });
    expect(screen.getByText("現在の期間終了時に変更し、それまでは現在のプランを維持")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "期間末の変更を予約" }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(expect.stringContaining("billing=change-scheduled")),
    );
    expect(mocks.createPlanChange).toHaveBeenCalledWith(
      undefined,
      { plan: "lite", interval: "month" },
      expect.any(AbortSignal),
    );
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("期間末変更の復帰URLで予約したPlanと適用日を表示する", async () => {
    window.history.replaceState(
      {},
      "",
      "/profile/billing?billing=change-scheduled&plan=lite&effective_at=2026-09-01T00%3A00%3A00.000Z",
    );
    mocks.fetchEntitlement.mockResolvedValue(entitlement("subscription"));

    render(<BillingPlanApplication onBack={vi.fn()} />);

    expect(
      await screen.findByText(
        "Liteへの変更を2026年9月1日に予約しました。それまでは現在のプランを利用できます。",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "契約を管理" })).toBeTruthy();
    expect(mocks.verifyCheckout).not.toHaveBeenCalled();
  });
});
