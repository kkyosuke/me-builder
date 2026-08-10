import { UserRound } from "lucide-react";
import type { AvatarSelection } from "../../model/avatar";

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

  return (
    <img src={avatar.src} alt="" className={`${commonClassName} object-cover`} aria-hidden="true" />
  );
}
