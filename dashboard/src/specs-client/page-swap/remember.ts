import { TRACKED_FORM_SELECTOR } from "../../page-contract.ts";

const pages = new Map<string, string>();

function key(address: string): string {
  const url = new URL(address, globalThis.location?.href);
  url.hash = "";
  return url.href;
}

export function rememberPage(address: string, doc: Document): void {
  const addressKey = key(address);
  if (doc.querySelector(TRACKED_FORM_SELECTOR)) {
    pages.delete(addressKey);
    return;
  }
  pages.set(addressKey, doc.documentElement.outerHTML);
}

export function rememberedPage(address: string): Document | null {
  const html = pages.get(key(address));
  return html ? new DOMParser().parseFromString(html, "text/html") : null;
}
