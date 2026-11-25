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

const DELAY_MS = 150;
// A press's cover stays until the press is answered: Escape does not lift it.
const overlay: { timer: ReturnType<typeof setTimeout> | null; dialog: HTMLDialogElement | null; held: boolean } = {
  timer: null,
  dialog: null,
  held: false,
};

/** The cover's dialog, made once and kept: a held cover answers Escape by
 *  staying up. */
function overlayDialog(): HTMLDialogElement {
  if (overlay.dialog) return overlay.dialog;
  document.body.insertAdjacentHTML(
    "beforeend",
    `<dialog class="pageoverlay">${SPINNER}` +
      '<p class="overlaynote" hidden></p></dialog>',
  );
  const dialog = document.body.lastElementChild as HTMLDialogElement;
  overlay.dialog = dialog;
  dialog.addEventListener?.("cancel", (event: Event) => {
    if (overlay.held) event.preventDefault();
  });
  // A browser closes a modal whose cancel was prevented on a second Escape: show it again.
  dialog.addEventListener?.("close", () => {
    if (overlay.held) overlay.dialog?.showModal();
  });
  return dialog;
}

function openOverlay(note = ""): void {
  const dialog = overlayDialog();
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

/** The cover, after the delay a fast answer never sees. */
function overlayAfterDelay(): void {
  overlay.timer = setTimeout(() => {
    overlay.timer = null;
    openOverlay(document.body?.dataset?.overlayNote || "");
  }, DELAY_MS);
}

function stopOverlayTimer(): void {
  if (overlay.timer !== null) clearTimeout(overlay.timer);
  overlay.timer = null;
}

/** The cover lifted, and a press's hold on it let go. */
function liftOverlay(): void {
  overlay.held = false;
  stopOverlayTimer();
  if (overlay.dialog?.open) overlay.dialog.close();
}

function overlayOnClick(event: Event): void {
  const e = event as MouseEvent;
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  if (overlay.timer !== null || (overlay.dialog?.open)) return;
  const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
  const href = link.getAttribute("href") || "";
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
  overlayAfterDelay();
}

(() => {
  document.addEventListener("click", overlayOnClick);
  document.addEventListener(PAGE_FETCHING, () => {
    if (overlay.timer !== null || overlay.dialog?.open) return;
    overlayAfterDelay();
  });
  document.addEventListener(PAGE_DRAWN, liftOverlay);

  // A press that queues a job (Deploy, Close, Reopen, Remove project) covers
  // the page at once with its own word, and lifts it again on a refusal.
  document.addEventListener("aide-cover", (event: Event) => {
    stopOverlayTimer();
    const note = (event as CustomEvent<{ note?: string } | undefined>).detail?.note;
    overlay.held = true;
    openOverlay(note || document.body?.dataset?.overlayNote || "");
  });
  document.addEventListener("aide-cover-done", liftOverlay);

  window.addEventListener("pageshow", (event: Event) => {
    if (!(event as PageTransitionEvent).persisted) return;
    liftOverlay();
  });
})();
