import { Flower2, type LucideIcon, Sparkles, SunMedium, UserRound, Waves } from "lucide-react";
import type { AvatarPresetId, AvatarSelection } from "../../model/avatar";

const presetStyles: Record<
  AvatarPresetId,
  { background: string; foreground: string; icon: LucideIcon }
> = {
  sunrise: {
    background: "from-amber-200 via-orange-300 to-rose-300",
    foreground: "text-rose-800",
    icon: SunMedium,
  },
  starlight: {
    background: "from-indigo-500 via-violet-500 to-fuchsia-400",
    foreground: "text-white",
    icon: Sparkles,
  },
  leaf: {
    background: "from-lime-200 via-emerald-300 to-teal-300",
    foreground: "text-emerald-900",
    icon: Flower2,
  },
  water: {
    background: "from-cyan-200 via-sky-300 to-blue-400",
    foreground: "text-blue-900",
    icon: Waves,
  },
};

const sizeStyles = {
  sm: "size-10",
  md: "size-16",
  lg: "size-28",
} as const;

const iconSizeStyles = {
  sm: "size-5",
  md: "size-8",
  lg: "size-14",
} as const;

export function AvatarPreview({
  avatar,
  size = "md",
}: {
  avatar: AvatarSelection | null;
  size?: keyof typeof sizeStyles;
}) {
  const commonClassName = `${sizeStyles[size]} shrink-0 overflow-hidden rounded-full ring-2 ring-white shadow-md shadow-slate-950/15 dark:ring-slate-700`;

  if (!avatar) {
    return (
      <span
        aria-hidden="true"
        className={`${commonClassName} flex items-center justify-center bg-gradient-to-br from-slate-200 to-slate-300 text-slate-500 dark:from-slate-700 dark:to-slate-800 dark:text-slate-300`}
      >
        <UserRound className={iconSizeStyles[size]} />
      </span>
    );
  }

  if (avatar.kind === "uploaded") {
    return (
      <img
        src={avatar.dataUrl}
        alt=""
        className={`${commonClassName} object-cover`}
        aria-hidden="true"
      />
    );
  }

  const style = presetStyles[avatar.presetId];
  const Icon = style.icon;
  return (
    <span
      aria-hidden="true"
      className={`${commonClassName} ${style.foreground} flex items-center justify-center bg-gradient-to-br ${style.background}`}
    >
      <Icon className={iconSizeStyles[size]} />
    </span>
  );
}
