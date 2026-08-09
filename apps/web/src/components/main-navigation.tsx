import { Brain, CalendarDays, HeartHandshake } from "lucide-react";
import { preloadMainApplication } from "../routes";

type MainNavigationItem = "compatibility" | "diagnosis" | "me";

const items = [
  { id: "me", href: "/me", label: "わたし", icon: Brain },
  { id: "diagnosis", href: "/diagnosis", label: "診断", icon: CalendarDays },
  { id: "compatibility", href: "/compatibility", label: "相性", icon: HeartHandshake },
] as const;

/** 一般利用者向けルート画面で、同じ位置と順序を保つ主ナビゲーション。 */
export function MainNavigation({ current }: { current: MainNavigationItem }) {
  return (
    <nav
      aria-label="メインナビゲーション"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
    >
      <div className="mx-auto grid max-w-2xl grid-cols-3 gap-2">
        {items.map((item) => {
          const isCurrent = item.id === current;
          const Icon = item.icon;
          const preloadDestination = () => {
            if (!isCurrent) preloadMainApplication(item.id);
          };
          return (
            <a
              key={item.id}
              href={item.href}
              aria-current={isCurrent ? "page" : undefined}
              onPointerEnter={preloadDestination}
              onFocus={preloadDestination}
              className={`flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm ${
                isCurrent
                  ? "bg-sky-400/15 font-bold text-sky-800 dark:text-sky-200"
                  : "font-semibold text-slate-600 dark:text-slate-300"
              }`}
            >
              <Icon className="size-5" aria-hidden="true" />
              {item.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
