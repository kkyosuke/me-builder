import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { InternalLink } from "../../../../components/internal-link";
import type { CompatibilityPerson } from "../../model/compatibility";
import { resolveCompatibilityRoute } from "../../model/compatibility-route";
import { preloadCompatibilityRoute } from "../compatibility-route-loaders";

export function CompatibilityAvatar({
  person,
  size = "md",
}: {
  person: CompatibilityPerson;
  size?: "md" | "lg";
}) {
  const color =
    person.color === "sky"
      ? "from-sky-300 to-cyan-500 text-sky-950"
      : "from-violet-300 to-fuchsia-500 text-violet-950";
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-[40%_60%_55%_45%] bg-gradient-to-br font-black shadow-lg ${color} ${
        size === "lg" ? "size-20 text-2xl" : "size-12 text-lg"
      }`}
    >
      {person.initial}
    </span>
  );
}

export function CompatibilityProfileAvatar({
  imageUrl,
  displayName,
  tone,
}: {
  imageUrl: string | null;
  displayName: string;
  tone: "sky" | "violet";
}) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const commonClassName =
    "size-20 shrink-0 overflow-hidden rounded-full ring-2 ring-white shadow-lg dark:ring-slate-700";

  if (imageUrl && imageUrl !== failedImageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        aria-hidden="true"
        className={`${commonClassName} object-cover`}
        onError={() => setFailedImageUrl(imageUrl)}
      />
    );
  }

  const color =
    tone === "sky"
      ? "from-sky-100 to-sky-200 text-sky-600 dark:from-sky-900 dark:to-slate-800 dark:text-sky-300"
      : "from-violet-100 to-violet-200 text-violet-600 dark:from-violet-900 dark:to-slate-800 dark:text-violet-300";
  return (
    <span
      aria-hidden="true"
      className={`${commonClassName} flex items-center justify-center bg-gradient-to-br ${color}`}
    >
      <span className="text-2xl font-black">{Array.from(displayName.trim())[0] ?? "?"}</span>
    </span>
  );
}

export function CompatibilityBackHeader({
  href = "/compatibility",
  label = "相性一覧",
}: {
  href?: string;
  label?: string;
}) {
  return (
    <header>
      <InternalLink
        href={href}
        onPreload={() => preloadCompatibilityRoute(resolveCompatibilityRoute(href))}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl pr-3 text-sm font-bold text-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 dark:text-sky-200"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        {label}
      </InternalLink>
    </header>
  );
}
