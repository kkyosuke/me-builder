import type { ProfileEntitlement } from "../../profile-settings/model/entitlement";

export async function waitForSubscriptionProjection(
  fetchEntitlement: (signal: AbortSignal) => Promise<ProfileEntitlement>,
  options: Readonly<{
    signal: AbortSignal;
    attempts?: number;
    intervalMs?: number;
  }>,
): Promise<ProfileEntitlement> {
  const attempts = options.attempts ?? 20;
  const intervalMs = options.intervalMs ?? 1_500;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const entitlement = await fetchEntitlement(options.signal);
    if (entitlement.source === "subscription" && entitlement.status === "active") {
      return entitlement;
    }
    if (attempt + 1 < attempts) await abortableDelay(intervalMs, options.signal);
  }
  throw new Error(
    "Stripeでの手続きは完了していますが、契約の反映に時間がかかっています。少し待ってから再確認してください。",
  );
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
