// The header's Deploy mark, drawn again when the event stream says it
// changed: the server draws it, in the page's language, and the page swaps
// it in.

/** The mark's slot in the header, and how the page asks for the mark. */
export interface MarkIo {
  slot(): { outerHTML: string } | null;
  /** The mark as the server draws it now; null when it did not answer. */
  fetchMark(): Promise<string | null>;
}

const MARK = /^<(a|span) class="deploymark"[\s>]/;

/** Asks for the mark and puts it in the header's slot. An answer that is
 *  not the mark leaves the slot as it is. */
export async function refreshDeployMark(io: MarkIo): Promise<void> {
  const html = (await io.fetchMark().catch(() => null))?.trim();
  if (!html || !MARK.test(html)) return;
  const slot = io.slot();
  if (slot && slot.outerHTML !== html) slot.outerHTML = html;
}

/** The browser's own: the header's slot, and `GET /api/deploy-mark`. */
export const browserMarkIo = (): MarkIo => ({
  slot: () => document.querySelector("header .deploymark"),
  fetchMark: async () => {
    const res = await fetch("/api/deploy-mark", { headers: { accept: "text/html" }, cache: "no-store" });
    return res.ok ? res.text() : null;
  },
});
