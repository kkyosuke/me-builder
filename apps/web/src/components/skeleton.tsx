import type { ReactNode } from "react";

export function SkeletonBlock({ className }: { className: string }) {
  return <div aria-hidden="true" className={`bg-slate-200 dark:bg-slate-700 ${className}`} />;
}

export function SkeletonLoader({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <output
      aria-label={label}
      aria-busy="true"
      className={`block animate-pulse motion-reduce:animate-none ${className ?? ""}`}
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </output>
  );
}
