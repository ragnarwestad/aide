import { PAGE_DRAWN, PAGE_FETCHING, SPINNER } from "../../../page-contract.ts";

// A click that leaves this page for another covers it, from the click
// until the new page is in place — the other half of what
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
// Like nav-busy.ts, this file can neither import nor export anything.

(() => {
  const DELAY_MS = 150;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dialog: HTMLDialogElement | null = null;
  // A press's cover stays until the press is answered: Escape does not lift it.
  let held = false;

  function openOverlay(note = ""): void {
    if (!dialog) {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<dialog class="pageoverlay">${SPINNER}` +
          '<p class="overlaynote" hidden></p></dialog>',
      );
      dialog = document.body.lastElementChild as HTMLDialogElement;
      dialog.addEventListener?.("cancel", (event: Event) => {
        if (held) event.preventDefault();
      });
      // A browser closes a modal whose cancel was prevented on a second Escape: show it again.
      dialog.addEventListener?.("close", () => {
        if (held) dialog?.showModal();
      });
    }
    // Optional-chained: the fake document the test runs this against
    // stubs the dialog, not a query engine. A navigation passes no note
    // and the paragraph stays hidden, exactly as before.
    const line = dialog.querySelector?.(".overlaynote") as HTMLElement | null;
    if (line) {
      line.textContent = note;
      line.hidden = !note;
    }
    if (!dialog.open) dialog.showModal();
  }

  document.addEventListener("click", (event: Event) => {
    const e = event as MouseEvent;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (timer !== null || (dialog?.open)) return;
    const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
    const href = link.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    timer = setTimeout(() => {
      timer = null;
      openOverlay(document.body?.dataset?.overlayNote || "");
    }, DELAY_MS);
  });

  document.addEventListener(PAGE_FETCHING, () => {
    if (timer !== null || dialog?.open) return;
    timer = setTimeout(() => {
      timer = null;
      openOverlay(document.body?.dataset?.overlayNote || "");
    }, DELAY_MS);
  });
  document.addEventListener(PAGE_DRAWN, () => {
    held = false;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (dialog?.open) dialog.close();
  });

  // A press that queues a job (Deploy, Close, Reopen, Remove project) covers
  // the page at once with its own word, and lifts it again on a refusal.
  document.addEventListener("aide-cover", (event: Event) => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const note = (event as CustomEvent<{ note?: string } | undefined>).detail?.note;
    held = true;
    openOverlay(note || document.body?.dataset?.overlayNote || "");
  });
  document.addEventListener("aide-cover-done", () => {
    held = false;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (dialog?.open) dialog.close();
  });

  window.addEventListener("pageshow", (event: Event) => {
    if (!(event as PageTransitionEvent).persisted) return;
    held = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (dialog?.open) dialog.close();
  });
})();
