const DAY_MS = 24 * 60 * 60 * 1_000;

/** Checkoutを本日完了した場合のtrial終了日を、課金運用の日本時間で案内する。 */
export function expectedTrialEndDate(trialDays: number, now = new Date()): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(now.getTime() + trialDays * DAY_MS));
}
