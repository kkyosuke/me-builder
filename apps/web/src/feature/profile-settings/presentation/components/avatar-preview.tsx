import { UserRound } from "lucide-react";
import { useState } from "react";
import type { AvatarSelection } from "../../model/avatar";

const sizeStyles = {
  sm: "size-10",
  md: "size-16",
  lg: "size-28",
  xl: "size-40",
} as const;

const iconSizeStyles = {
  sm: "size-5",
  md: "size-8",
  lg: "size-14",
  xl: "size-20",
} as const;

export function AvatarPreview({
  avatar,
  fallbackImageUrl,
  size = "md",
}: {
  avatar: AvatarSelection | null;
  fallbackImageUrl?: string | undefined;
  size?: keyof typeof sizeStyles;
}) {
  const commonClassName = `${sizeStyles[size]} shrink-0 overflow-hidden rounded-full ring-2 ring-white shadow-md shadow-slate-950/15 dark:ring-slate-700`;
  const imageUrl = avatar?.dataUrl ?? fallbackImageUrl;
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

  if (imageUrl && imageUrl !== failedImageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        className={`${commonClassName} object-cover`}
        aria-hidden="true"
        onError={() => setFailedImageUrl(imageUrl)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${commonClassName} flex items-center justify-center bg-gradient-to-br from-slate-200 to-slate-300 text-slate-500 dark:from-slate-700 dark:to-slate-800 dark:text-slate-300`}
    >
      <UserRound className={iconSizeStyles[size]} />
    </span>
  );
}
