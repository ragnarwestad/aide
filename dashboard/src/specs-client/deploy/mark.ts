// The header's Deploy mark, drawn again when the event stream says it
// changed: the server draws it, in the page's language, and the page swaps
// it in.

/** The mark's slot in the header, and how the page asks for the mark. */
export interface MarkIo {
  slot(): { outerHTML: string } | null;
  /** The mark as the server draws it now; null when it did not answer. */
  fetchMark(): Promise<string | null>;
  hasElement(id: string): boolean;
  addDialog(html: string): void;
  syncControls?(mark: string): void;
}

const MARK = /^<(button|span) class="deploymark[\s"]/;

/** Asks for the mark and puts it in the header's slot. An answer that is
 *  not the mark leaves the slot as it is. */
export async function refreshDeployMark(io: MarkIo): Promise<void> {
  const html = (await io.fetchMark().catch(() => null))?.trim();
  if (!html || !MARK.test(html)) return;
  const dialogAt = html.indexOf("<dialog");
  const mark = dialogAt < 0 ? html : html.slice(0, dialogAt);
  const slot = io.slot();
  if (slot && slot.outerHTML !== mark) slot.outerHTML = mark;
  io.syncControls?.(mark);
  if (dialogAt < 0) return;
  const dialog = html.slice(dialogAt);
  const id = /^<dialog\b[^>]*\sid="([^"]+)"/.exec(dialog)?.[1];
  if (id && !io.hasElement(id)) io.addDialog(dialog);
}

export function syncDeployControls(doc: Document, html: string): void {
  const mark = new doc.defaultView!.DOMParser().parseFromString(html, "text/html").querySelector<HTMLElement>("[data-deploy-project]");
  if (!mark) return;
  const busy = mark.dataset.deployUnderWay === "true";
  for (const button of doc.querySelectorAll<HTMLButtonElement>("button[data-deploy-ready]")) {
    if (button.dataset.deployProject !== mark.dataset.deployProject) continue;
    button.disabled = busy || Number(mark.dataset.deployCommits) === 0 || button.dataset.deployReady === "false";
    button.title = busy ? mark.title : button.dataset.deployIdleTitle ?? "";
  }
}

/** The browser's own: the header's slot, and `GET /api/deploy-mark`. */
export const browserMarkIo = (): MarkIo => ({
  slot: () => document.querySelector("header .deploymark"),
  syncControls: (html) => syncDeployControls(document, html),
  hasElement: (id) => document.getElementById(id) !== null,
  addDialog: (html) => document.querySelector("header > .boardline")?.insertAdjacentHTML("afterend", html),
  fetchMark: async () => {
    const res = await fetch("/api/deploy-mark", { headers: { accept: "text/html" }, cache: "no-store" });
    return res.ok ? res.text() : null;
  },
});
