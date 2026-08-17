import { Sparkles, UsersRound } from "lucide-react";
import type { ProfileEntitlement } from "../../model/entitlement";

const planBadge = {
  free: {
    label: "FREE",
    accessibleLabel: "Free",
    className:
      "border-white bg-slate-700 text-white shadow-slate-950/25 dark:border-slate-700 dark:bg-slate-200 dark:text-slate-900",
  },
  lite: {
    label: "LITE",
    accessibleLabel: "Lite",
    className:
      "border-amber-50 bg-gradient-to-r from-amber-300 to-yellow-500 text-amber-950 shadow-amber-950/25",
    icon: Sparkles,
  },
  full: {
    label: "FULL",
    accessibleLabel: "Full",
    className:
      "border-amber-50 bg-gradient-to-r from-amber-300 to-yellow-500 text-amber-950 shadow-amber-950/25",
    icon: Sparkles,
  },
  family: {
    label: "FAMILY",
    accessibleLabel: "ファミリーパック",
    className:
      "border-violet-100 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-violet-950/25",
    icon: UsersRound,
  },
} as const;

export function ProfilePlanBadge({
  plan,
  descriptionId,
}: {
  plan: ProfileEntitlement["plan"];
  descriptionId?: string | undefined;
}) {
  const badge = planBadge[plan];
  const Icon = "icon" in badge ? badge.icon : null;

  return (
    <>
      <span
        aria-hidden="true"
        className={`${badge.className} absolute -right-1 -bottom-1 flex h-5 items-center gap-0.5 rounded-full border-2 px-1.5 text-[0.5rem] leading-none font-black tracking-[0.08em] shadow-md`}
      >
        {Icon && <Icon className="size-2.5" strokeWidth={3} />}
        {badge.label}
      </span>
      <span id={descriptionId} className="sr-only">
        現在のプラン: {badge.accessibleLabel}
      </span>
    </>
  );
}
