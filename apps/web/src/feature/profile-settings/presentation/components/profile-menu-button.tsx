import { forwardRef } from "react";
import type { AvatarSelection } from "../../model/avatar";
import { AvatarPreview } from "./avatar-preview";

export const ProfileMenuButton = forwardRef<
  HTMLButtonElement,
  {
    avatar: AvatarSelection | null;
    linePictureUrl?: string | undefined;
    onOpen: () => void;
    onPreload: () => void;
  }
>(({ avatar, linePictureUrl, onOpen, onPreload }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label="プロフィールを開く"
    title="プロフィールを開く"
    onClick={onOpen}
    onPointerEnter={onPreload}
    onFocus={onPreload}
    className="fixed top-[max(1rem,env(safe-area-inset-top))] right-4 z-50 rounded-full bg-white/90 p-0.5 shadow-lg shadow-slate-950/15 backdrop-blur transition hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 motion-reduce:hover:scale-100 dark:bg-slate-800/90"
  >
    {!avatar && linePictureUrl ? (
      <img
        src={linePictureUrl}
        alt=""
        aria-hidden="true"
        className="size-10 rounded-full object-cover ring-2 ring-white shadow-md shadow-slate-950/15 dark:ring-slate-700"
      />
    ) : (
      <AvatarPreview avatar={avatar} size="sm" />
    )}
  </button>
));

ProfileMenuButton.displayName = "ProfileMenuButton";
