export type TakenLink = { url: URL; referrer: "page" | "none" };

export function takesLink(
  event: MouseEvent,
  link: HTMLAnchorElement,
  here: string,
): TakenLink | null {
  if (
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0
  )
    return null;
  if ((link.target && link.target !== "_self") || link.hasAttribute("download"))
    return null;
  const href = link.getAttribute("href") ?? "";
  if (!href || href.startsWith("#")) return null;
  const now = new URL(here);
  const url = new URL(href, now);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== now.origin ||
    url.pathname.startsWith("/api/")
  )
    return null;
  if (
    url.pathname === now.pathname &&
    url.search === now.search &&
    url.hash !== now.hash
  )
    return null;
  return {
    url,
    referrer: link.getAttribute("rel")?.split(/\s+/).includes("noreferrer")
      ? "none"
      : "page",
  };
}

export function sameAddress(left: string, right: string): boolean {
  const rightUrl = new URL(
    right,
    globalThis.location?.href ?? "http://localhost/",
  );
  const leftUrl = new URL(left, rightUrl);
  return (
    leftUrl.origin === rightUrl.origin &&
    leftUrl.pathname === rightUrl.pathname &&
    leftUrl.search === rightUrl.search
  );
}
