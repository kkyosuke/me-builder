import { forwardRef, useId } from "react";
import type { AvatarSelection } from "../../model/avatar";
import type { ProfileEntitlement } from "../../model/entitlement";
import { AvatarPreview } from "./avatar-preview";
import { ProfilePlanBadge } from "./profile-plan-badge";

export const ProfileMenuButton = forwardRef<
  HTMLButtonElement,
  {
    avatar: AvatarSelection | null;
    plan?: ProfileEntitlement["plan"] | undefined;
    linePictureUrl?: string | undefined;
    onOpen: () => void;
    onPreload: () => void;
  }
>(({ avatar, plan, linePictureUrl, onOpen, onPreload }, ref) => {
  const planDescriptionId = useId();

  return (
    <button
      ref={ref}
      type="button"
      aria-label="プロフィールを開く"
      aria-describedby={plan ? planDescriptionId : undefined}
      title="プロフィールを開く"
      onClick={onOpen}
      onPointerEnter={onPreload}
      onFocus={onPreload}
      className="fixed top-[max(1rem,env(safe-area-inset-top))] right-4 z-50 rounded-full bg-white/90 p-0.5 shadow-lg shadow-slate-950/15 backdrop-blur transition hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 motion-reduce:hover:scale-100 dark:bg-slate-800/90"
    >
      <AvatarPreview avatar={avatar} fallbackImageUrl={linePictureUrl} size="sm" />
      {plan && <ProfilePlanBadge plan={plan} descriptionId={planDescriptionId} />}
    </button>
  );
});

ProfileMenuButton.displayName = "ProfileMenuButton";
