// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfileEntitlement } from "../../profile-settings/model/entitlement";
import type { BillingPlan } from "../model/billing-plan";
import { BillingPlanScreen } from "./billing-plan-screen";

const plans: readonly BillingPlan[] = [
  {
    code: "lite",
    name: "Lite",
    description: "週次の振り返り",
    highlights: ["AI返信 月150回"],
    trialDays: null,
    prices: [
      { interval: "month", amount: 780, currency: "JPY" },
      { interval: "year", amount: 7_800, currency: "JPY" },
    ],
  },
  {
    code: "full",
    name: "Full",
    description: "過去の変化とセルフケア",
    highlights: ["AI返信 月600回"],
    trialDays: null,
    prices: [
      { interval: "month", amount: 1_480, currency: "JPY" },
      { interval: "year", amount: 14_800, currency: "JPY" },
    ],
  },
  {
    code: "family",
    name: "ファミリーパック",
    description: "最大4 Account",
    highlights: ["1人あたりFull相当"],
    trialDays: null,
    prices: [
      { interval: "month", amount: 2_980, currency: "JPY" },
      { interval: "year", amount: 29_800, currency: "JPY" },
    ],
  },
];

const free: ProfileEntitlement = {
  status: "free",
  plan: "free",
  source: "free",
  effectiveAt: "2026-08-16T00:00:00.000Z",
  availableUntil: null,
  aiReply: {
    limit: 60,
    used: 0,
    reserved: 0,
    remaining: 60,
    periodStartsAt: "2026-08-16T00:00:00.000Z",
    resetsAt: "2026-09-16T00:00:00.000Z",
  },
};

describe("BillingPlanScreen", () => {
  afterEach(cleanup);

  it("Production向け表示ではFreeだけを案内し、有料Planと購入導線を隠す", () => {
    render(
      <BillingPlanScreen
        plans={{ status: "success", data: plans }}
        entitlement={{ status: "success", data: free }}
        checkoutState={{ status: "idle" }}
        completionMessage={null}
        onBack={vi.fn()}
        onCheckout={vi.fn()}
        onManageSubscription={vi.fn()}
        onRetry={vi.fn()}
        paidPlansAvailable={false}
      />,
    );

    expect(screen.getByText("現在は無料で利用できます")).toBeTruthy();
    expect(screen.queryByText("Lite")).toBeNull();
    expect(screen.queryByText(/トライアル/)).toBeNull();
    expect(screen.queryByRole("button", { name: /プランを変更する/ })).toBeNull();
  });

  it("価格と更新・解約条件を確認してからCheckoutを開始する", () => {
    const onCheckout = vi.fn();
    render(
      <BillingPlanScreen
        plans={{ status: "success", data: plans }}
        entitlement={{ status: "success", data: free }}
        checkoutState={{ status: "idle" }}
        completionMessage={null}
        onBack={vi.fn()}
        onCheckout={onCheckout}
        onManageSubscription={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("radio", { name: "ノーマル Lite" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "プレミアム Full" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "ファミリー ファミリーパック" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "プレミアム Full" }));
    expect(screen.getAllByText(/1,480/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: "ノーマル Lite" }));
    fireEvent.click(screen.getByRole("radio", { name: "年額" }));
    expect(screen.getAllByText(/7,800/)).toHaveLength(2);
    expect(screen.getByText(/月額払いより年間.*1,560.*お得/)).toBeTruthy();
    expect(screen.getByText("約17%OFF")).toBeTruthy();
    expect(screen.getByText(/月あたり約.*650.*利用できます/)).toBeTruthy();
    expect(screen.getByText(/年間.*1,560.*お得/, { selector: "footer p" })).toBeTruthy();
    expect(screen.getByText(/自動更新/)).toBeTruthy();
    expect(screen.getByText(/期間末解約/)).toBeTruthy();
    const purchaseButton = screen.getByRole("button", { name: /プランを変更する/ });
    expect(purchaseButton.closest("footer")?.className).toContain("fixed");
    fireEvent.click(purchaseButton);

    expect(onCheckout).toHaveBeenCalledWith("lite", "year");
  });

  it("公開カタログが空なら空白にせず再読み込みを案内する", () => {
    const onRetry = vi.fn();
    render(
      <BillingPlanScreen
        plans={{ status: "success", data: [] }}
        entitlement={{ status: "success", data: free }}
        checkoutState={{ status: "idle" }}
        completionMessage={null}
        onBack={vi.fn()}
        onCheckout={vi.fn()}
        onManageSubscription={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("料金プランを表示できません");
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("safe defaultをFree契約と表示せず、再確認まで購入を止める", () => {
    const onRetry = vi.fn();
    render(
      <BillingPlanScreen
        plans={{ status: "success", data: plans }}
        entitlement={{
          status: "success",
          data: { ...free, status: "safe-default" },
        }}
        checkoutState={{ status: "idle" }}
        completionMessage={null}
        onBack={vi.fn()}
        onCheckout={vi.fn()}
        onManageSubscription={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("契約状態を確認中")).toBeTruthy();
    expect(screen.getByText(/Free契約へ変更されたことを示す表示ではありません/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /プランを変更する/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "契約状態を再確認" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("表示時に閉じるボタンへフォーカスし、ファミリー参加中は購入操作を表示しない", () => {
    render(
      <BillingPlanScreen
        plans={{ status: "success", data: plans }}
        entitlement={{
          status: "success",
          data: { ...free, status: "active", plan: "family", source: "family-seat" },
        }}
        checkoutState={{ status: "idle" }}
        completionMessage={null}
        onBack={vi.fn()}
        onCheckout={vi.fn()}
        onManageSubscription={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "料金プランを閉じる" }));
    expect(screen.getByText("ファミリーパックに参加中です")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "ノーマル Lite" })).toBeNull();
    expect(screen.queryByRole("button", { name: /プランを変更する/ })).toBeNull();
  });

  it("初回対象者へ終了日と終了後の価格・自動更新を開始前に表示する", () => {
    render(
      <BillingPlanScreen
        plans={{
          status: "success",
          data: plans.map((plan) => ({ ...plan, trialDays: 14 })),
        }}
        entitlement={{ status: "success", data: free }}
        checkoutState={{ status: "idle" }}
        completionMessage={null}
        onBack={vi.fn()}
        onCheckout={vi.fn()}
        onManageSubscription={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText(/初回.*14日間無料/)).toBeTruthy();
    expect(screen.getByText(/本日開始した場合.*まで無料/)).toBeTruthy();
    expect(screen.getByText(/終了後は.*780.*毎月自動更新/)).toBeTruthy();
  });

  it("Liteへの変更前に古い合意順の停止予定Goalを表示して了承を求める", () => {
    const onCheckout = vi.fn();
    render(
      <BillingPlanScreen
        plans={{ status: "success", data: plans }}
        entitlement={{
          status: "success",
          data: { ...free, status: "active", plan: "full", source: "subscription" },
        }}
        goalFollowUps={{
          status: "success",
          data: {
            canManage: true,
            activeLimit: null,
            candidates: [],
            items: [
              {
                id: "newer",
                brainItemId: "brain-newer",
                goal: "新しいGoal",
                nextStep: "新しい一歩",
                status: "active",
                agreedAt: "2026-08-02T00:00:00.000Z",
                updatedAt: "2026-08-02T00:00:00.000Z",
              },
              {
                id: "older",
                brainItemId: "brain-older",
                goal: "古いGoal",
                nextStep: "古い一歩",
                status: "active",
                agreedAt: "2026-08-01T00:00:00.000Z",
                updatedAt: "2026-08-01T00:00:00.000Z",
              },
            ],
          },
        }}
        checkoutState={{ status: "idle" }}
        completionMessage={null}
        onBack={vi.fn()}
        onCheckout={onCheckout}
        onManageSubscription={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "ノーマル Lite" }));
    fireEvent.click(screen.getByRole("button", { name: "期間末の変更を予約" }));
    expect(screen.getByRole("alertdialog", { name: "停止予定のGoalを確認" })).toBeTruthy();
    expect(screen.getByText("古いGoal")).toBeTruthy();
    expect(screen.queryByText("新しいGoal")).toBeNull();
    expect(onCheckout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "了承して変更へ進む" }));
    expect(onCheckout).toHaveBeenCalledWith("lite", "month");
  });
});
