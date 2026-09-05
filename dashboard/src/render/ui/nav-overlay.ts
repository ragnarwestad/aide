// A click that leaves this page for another covers it, from the click
// until the new document replaces this one — the other half of what
// nav-busy.ts's pale link leaves unsaid: gone the instant the pointer
// moves off the link, and never shown at all on a touch screen.
//
// A short delay before it appears, so a fast answer never flashes it.
// A native <dialog> covers the page and blocks input at the platform
// level — showModal() traps focus and its ::backdrop swallows clicks,
// so nothing here toggles `inert` by hand.
//
// bfcache: the browser can restore this exact page, dialog open and
// all, when the reader presses Back into it. `pageshow` with
// `persisted` true is the signal that happened, and closes it.
//
// Like nav-busy.ts, this file can neither import nor export anything;
// test/render/ui/nav-overlay.test.ts runs it against a fake document
// AND a fake window — unlike nav-busy.ts/form-busy.ts, which only ever
// need the former, this file's pageshow listener needs `window` passed
// in as its own argument too, or the transpiled IIFE throws
// ReferenceError the moment it runs (there is no global `window` under
// `bun test`).

(() => {
  const DELAY_MS = 150;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dialog: HTMLDialogElement | null = null;

  function openOverlay(): void {
    if (!dialog) {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<dialog class="pageoverlay"><span class="spin" aria-hidden="true"></span></dialog>',
      );
      dialog = document.body.lastElementChild as HTMLDialogElement;
    }
    if (!dialog.open) dialog.showModal();
  }

  document.addEventListener("click", (event: Event) => {
    const e = event as MouseEvent;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (timer !== null || (dialog && dialog.open)) return;
    const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
    const href = link.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    timer = setTimeout(() => {
      timer = null;
      openOverlay();
    }, DELAY_MS);
  });

  // REQ-8 (spec 391): a Save form's own POST is, from the browser's
  // perspective, the same kind of "this document is about to be
  // replaced" event a link click is — this document IS replaced by the
  // 303 back, once the request answers. No delay, unlike the click
  // case above: a Save always commits and pushes for real, so there is
  // no fast case to avoid flashing for.
  document.addEventListener("submit", (event: Event) => {
    const e = event as Event & { defaultPrevented: boolean };
    if (e.defaultPrevented) return;
    const form = e.target as { matches?: (selector: string) => boolean } | null;
    if (!form?.matches?.(".specform") || timer !== null || (dialog && dialog.open)) return;
    openOverlay();
  });

  window.addEventListener("pageshow", (event: Event) => {
    if (!(event as PageTransitionEvent).persisted) return;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (dialog && dialog.open) dialog.close();
  });
})();
