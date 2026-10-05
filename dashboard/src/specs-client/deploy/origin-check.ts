// The Deploy tab asks origin the moment it is open, and draws itself again
// from the answer: the server decides the sentence and the button, the page
// only swaps in what the server now draws.

import { bindDeployForms } from "./index.ts";

export interface OriginCheckIo {
  /** Posts the check; true only for an answer that says `ok`. */
  check(): Promise<boolean>;
  /** The page as the server draws it now; null when it did not answer. */
  page(): Promise<string | null>;
}

function browserIo(section: HTMLElement): OriginCheckIo {
  return {
    check: async () => {
      const res = await fetch(section.dataset.originCheck ?? "", { method: "POST", headers: { accept: "application/json" } });
      const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      return res.ok && body?.ok === true;
    },
    page: async () => {
      const res = await fetch(location.href, { headers: { accept: "text/html" }, cache: "no-store" });
      return res.ok ? await res.text() : null;
    },
  };
}

/** Asks, then redraws the section from the page the server draws now —
 *  unless the check failed, Deploy was pressed meanwhile, or a dialog is open. */
export async function checkOrigin(section: HTMLElement, io: OriginCheckIo, rebind: (root: ParentNode) => void): Promise<void> {
  let pressed = false;
  section.addEventListener("submit", () => (pressed = true), true);
  if (!(await io.check().catch(() => false))) return;
  const html = await io.page().catch(() => null);
  const doc = section.ownerDocument;
  if (!html || pressed || !section.isConnected || doc.querySelector("dialog[open]")) return;
  const fresh = new doc.defaultView!.DOMParser().parseFromString(html, "text/html").querySelector("[data-origin-check]");
  if (!fresh) return;
  const node = doc.importNode(fresh, true);
  section.replaceWith(node);
  rebind(node);
}

/** The page's Deploy section, when it has one, checked once at load. */
export function startOriginCheck(
  doc: Document,
  makeIo: (section: HTMLElement) => OriginCheckIo = browserIo,
  rebind: (root: ParentNode) => void = (root) => bindDeployForms(root),
): void {
  const section = doc.querySelector("[data-origin-check]") as HTMLElement | null;
  if (!section?.dataset?.originCheck) return; // every other page — and the stand-in documents the page-script tests use
  void checkOrigin(section, makeIo(section), rebind);
}
