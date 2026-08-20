import type { BillingInterval, PaidPlanCode } from "@me-builder/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { config } from "../../../config";
import { reportHandledOperationError } from "../../../infrastructure/web-error-reporter";
import type { AsyncState } from "../../../model/async-state";
import { openLiffWindow } from "../../liff/infrastructure/liff-client";
import { fetchProfileEntitlement } from "../../profile-settings/infrastructure/entitlement-api";
import type { ProfileEntitlement } from "../../profile-settings/model/entitlement";
import { fetchGoalFollowUps } from "../../profile/infrastructure/goal-follow-up-api";
import type { GoalFollowUpResult } from "../../profile/model/goal-follow-up";
import {
  createCheckoutSession,
  createCustomerPortalSession,
  createPlanChangeSession,
  fetchBillingPlanCatalog,
  fetchBillingTrialEligibility,
  verifyCheckoutSessionCompletion,
} from "../infrastructure/billing-api";
import type { BillingPlan } from "../model/billing-plan";
import { waitForSubscriptionProjection } from "../model/checkout-return";
import { BillingPlanScreen } from "./billing-plan-screen";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "操作を完了できませんでした。";
}

async function loadBillingPlans(signal: AbortSignal): Promise<AsyncState<readonly BillingPlan[]>> {
  const [catalogResult, trialResult] = await Promise.allSettled([
    fetchBillingPlanCatalog(config.apiUrl, signal),
    fetchBillingTrialEligibility(config.apiUrl, signal),
  ]);
  if (catalogResult.status === "rejected") {
    return { status: "error", message: message(catalogResult.reason) };
  }
  const trialEligible = trialResult.status === "fulfilled" && trialResult.value;
  return {
    status: "success",
    data: catalogResult.value.map((plan) => ({
      ...plan,
      trialDays: trialEligible ? plan.trialDays : null,
    })),
  };
}

function initialCompletionMessage(search: string): string | null {
  const params = new URLSearchParams(search);
  const result = params.get("billing");
  if (result === "checkout-cancel") return "購入手続きをキャンセルしました。";
  if (result !== "change-scheduled") return null;
  const planName = {
    lite: "Lite",
    full: "Full",
    family: "ファミリーパック",
  }[params.get("plan") ?? ""];
  const effectiveAt = params.get("effective_at");
  const effectiveDate = effectiveAt ? new Date(effectiveAt) : null;
  if (!planName || !effectiveDate || Number.isNaN(effectiveDate.getTime())) {
    return "期間末のプラン変更を予約しました。";
  }
  return `${planName}への変更を${new Intl.DateTimeFormat("ja-JP", { dateStyle: "long" }).format(effectiveDate)}に予約しました。それまでは現在のプランを利用できます。`;
}

export default function BillingPlanApplication({
  onBack,
  onEntitlementChanged,
  navigateToCheckout = (url) => {
    if (!openLiffWindow(url)) window.location.assign(url);
  },
  projectionPollIntervalMs = 1_500,
}: {
  onBack: () => void;
  onEntitlementChanged?: (entitlement: ProfileEntitlement) => void;
  navigateToCheckout?: (url: string) => void;
  projectionPollIntervalMs?: number;
}) {
  const checkoutResult = useMemo(
    () => new URLSearchParams(window.location.search).get("billing"),
    [],
  );
  const checkoutSessionId = useMemo(
    () => new URLSearchParams(window.location.search).get("session_id"),
    [],
  );
  const loadController = useRef<AbortController | null>(null);
  const operationController = useRef<AbortController | null>(null);
  const [plans, setPlans] = useState<AsyncState<readonly BillingPlan[]>>({ status: "loading" });
  const [entitlement, setEntitlement] = useState<AsyncState<ProfileEntitlement>>({
    status: "loading",
  });
  const [goalFollowUps, setGoalFollowUps] = useState<AsyncState<GoalFollowUpResult>>({
    status: "loading",
  });
  const [checkoutState, setCheckoutState] = useState<AsyncState<string>>({ status: "idle" });
  const [completionMessage, setCompletionMessage] = useState<string | null>(() =>
    initialCompletionMessage(window.location.search),
  );

  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setPlans({ status: "loading" });
    setEntitlement({ status: "loading" });
    setGoalFollowUps({ status: "loading" });
    const [plansResult, entitlementResult, goalFollowUpResult] = await Promise.allSettled([
      loadBillingPlans(controller.signal),
      fetchProfileEntitlement(config.apiUrl, controller.signal),
      fetchGoalFollowUps(config.apiUrl, controller.signal),
    ]);
    if (controller.signal.aborted) return;
    setPlans(
      plansResult.status === "fulfilled"
        ? plansResult.value
        : { status: "error", message: message(plansResult.reason) },
    );
    setEntitlement(
      entitlementResult.status === "fulfilled"
        ? { status: "success", data: entitlementResult.value }
        : { status: "error", message: message(entitlementResult.reason) },
    );
    setGoalFollowUps(
      goalFollowUpResult.status === "fulfilled"
        ? { status: "success", data: goalFollowUpResult.value }
        : { status: "error", message: message(goalFollowUpResult.reason) },
    );
  }, []);

  useEffect(() => {
    if (checkoutResult === "checkout-return") return;
    void load();
    return () => loadController.current?.abort();
  }, [checkoutResult, load]);

  useEffect(() => {
    if (checkoutResult !== "checkout-return") return;
    const controller = new AbortController();
    setPlans({ status: "loading" });
    setEntitlement({ status: "loading" });
    setGoalFollowUps({ status: "loading" });
    void (async () => {
      try {
        if (!checkoutSessionId) {
          throw new Error("購入結果を確認できませんでした。料金プランからやり直してください。");
        }
        await verifyCheckoutSessionCompletion(config.apiUrl, checkoutSessionId, controller.signal);
        const [plansResult, entitlementResult, goalFollowUpResult] = await Promise.allSettled([
          loadBillingPlans(controller.signal),
          waitForSubscriptionProjection(
            async (signal) => fetchProfileEntitlement(config.apiUrl, signal),
            { signal: controller.signal, intervalMs: projectionPollIntervalMs },
          ),
          fetchGoalFollowUps(config.apiUrl, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setPlans(
          plansResult.status === "fulfilled"
            ? plansResult.value
            : { status: "error", message: message(plansResult.reason) },
        );
        setGoalFollowUps(
          goalFollowUpResult.status === "fulfilled"
            ? { status: "success", data: goalFollowUpResult.value }
            : { status: "error", message: message(goalFollowUpResult.reason) },
        );
        if (entitlementResult.status === "rejected") {
          setEntitlement({ status: "error", message: message(entitlementResult.reason) });
          return;
        }
        const nextEntitlement = entitlementResult.value;
        setEntitlement({ status: "success", data: nextEntitlement });
        const planName = {
          free: "Free",
          lite: "Lite",
          full: "Full",
          family: "ファミリーパック",
        }[nextEntitlement.plan];
        setCompletionMessage(`${planName}が利用できるようになりました。`);
        onEntitlementChanged?.(nextEntitlement);
      } catch (error) {
        if (controller.signal.aborted) return;
        const errorMessage = message(error);
        setPlans({ status: "error", message: errorMessage });
        setEntitlement({ status: "error", message: errorMessage });
        setGoalFollowUps({ status: "error", message: errorMessage });
      }
    })();
    return () => controller.abort();
  }, [checkoutResult, checkoutSessionId, onEntitlementChanged, projectionPollIntervalMs]);

  useEffect(
    () => () => {
      loadController.current?.abort();
      operationController.current?.abort();
    },
    [],
  );

  const runBillingRedirect = useCallback(
    async (
      operation: "billing-checkout" | "billing-plan-change" | "billing-portal",
      createUrl: (signal: AbortSignal) => Promise<string>,
    ) => {
      operationController.current?.abort();
      const controller = new AbortController();
      operationController.current = controller;
      setCheckoutState({ status: "loading" });
      try {
        const url = await createUrl(controller.signal);
        if (controller.signal.aborted) return;
        setCheckoutState({ status: "success", data: url });
        navigateToCheckout(url);
      } catch (error) {
        if (controller.signal.aborted) return;
        reportHandledOperationError(operation, error);
        setCheckoutState({ status: "error", message: message(error) });
      }
    },
    [navigateToCheckout],
  );

  const checkout = (plan: PaidPlanCode, interval: BillingInterval) => {
    const changingPlan =
      entitlement.status === "success" && entitlement.data.source === "subscription";
    return runBillingRedirect(
      changingPlan ? "billing-plan-change" : "billing-checkout",
      async (signal) => {
        if (entitlement.status === "success" && entitlement.data.source === "family-seat") {
          throw new Error(
            "ファミリーパックに参加中です。個人契約を購入するには、先にファミリー席から退出してください。",
          );
        }
        return changingPlan
          ? createPlanChangeSession(config.apiUrl, { plan, interval }, signal)
          : createCheckoutSession(config.apiUrl, { plan, interval }, signal);
      },
    );
  };

  const manageSubscription = () =>
    runBillingRedirect("billing-portal", (signal) =>
      createCustomerPortalSession(config.apiUrl, signal),
    );

  return (
    <BillingPlanScreen
      plans={plans}
      entitlement={entitlement}
      goalFollowUps={goalFollowUps}
      checkoutState={checkoutState}
      completionMessage={completionMessage}
      onBack={onBack}
      onCheckout={(plan, interval) => void checkout(plan, interval)}
      onManageSubscription={() => void manageSubscription()}
      onRetry={() => void load()}
    />
  );
}
