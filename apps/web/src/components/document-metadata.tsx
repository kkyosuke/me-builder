import { useEffect } from "react";

type MetadataElement = HTMLMetaElement | HTMLLinkElement;

function restoreAttribute(element: MetadataElement, name: string, previous: string | null) {
  if (previous === null) {
    element.removeAttribute(name);
    return;
  }
  element.setAttribute(name, previous);
}

export function DocumentMetadata({
  title,
  description,
  robots,
  canonicalUrl,
}: {
  title: string;
  description?: string;
  robots: "index,follow" | "noindex,nofollow";
  canonicalUrl?: string;
}) {
  useEffect(() => {
    const previousTitle = document.title;
    const previousDescription = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousRobots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previousCanonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const descriptionElement = previousDescription ?? document.createElement("meta");
    const robotsElement = previousRobots ?? document.createElement("meta");
    const canonicalElement = previousCanonical ?? document.createElement("link");
    const previousDescriptionContent = previousDescription?.getAttribute("content") ?? null;
    const previousRobotsContent = previousRobots?.getAttribute("content") ?? null;
    const previousCanonicalHref = previousCanonical?.getAttribute("href") ?? null;

    if (!previousDescription) {
      descriptionElement.name = "description";
      document.head.append(descriptionElement);
    }
    if (!previousRobots) {
      robotsElement.name = "robots";
      document.head.append(robotsElement);
    }
    if (!previousCanonical) {
      canonicalElement.rel = "canonical";
      document.head.append(canonicalElement);
    }

    document.title = title;
    descriptionElement.content = description ?? "";
    robotsElement.content = robots;
    if (canonicalUrl) canonicalElement.href = canonicalUrl;
    else canonicalElement.removeAttribute("href");

    return () => {
      document.title = previousTitle;
      if (previousDescription) {
        restoreAttribute(descriptionElement, "content", previousDescriptionContent);
      } else {
        descriptionElement.remove();
      }
      if (previousRobots) {
        restoreAttribute(robotsElement, "content", previousRobotsContent);
      } else {
        robotsElement.remove();
      }
      if (previousCanonical) {
        restoreAttribute(canonicalElement, "href", previousCanonicalHref);
      } else {
        canonicalElement.remove();
      }
    };
  }, [canonicalUrl, description, robots, title]);

  return null;
}
