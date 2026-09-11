// The PDF button looks pressed the moment it is clicked, and stays that
// way until the reader is back on this tab (spec 358, REQ-6) — the one
// control on this dashboard that opens in a NEW tab rather than either
// posting a form (`form-busy.ts`) or navigating this one away
// (`nav-busy.ts`/`nav-overlay.ts`), both of which explicitly decline a
// target="_blank" link because their own signals (a 303 back to this
// page, this document being replaced) never fire for one. The closest
// first-party signal that the new tab's own work is done is this tab
// regaining focus — imprecise (many browsers switch focus to the new tab
// immediately, and a reader who never switches back keeps the busy look
// showing), but cosmetic only: the link and the PDF are unaffected
// either way.
//
// Like its siblings, this file can neither import nor export anything;
// test/render/ui/pdf-busy.test.ts runs it against a fake document AND a
// fake window.

(() => {
  const SPINNER = '<span class="spin" aria-hidden="true"></span>';

  document.addEventListener("click", (event: Event) => {
    const e = event as MouseEvent;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const link = (e.target as Element | null)?.closest?.("a[data-pdf]") as HTMLAnchorElement | null;
    if (!link || link.classList.contains("busy")) return;
    link.classList.add("busy");
    link.insertAdjacentHTML("afterbegin", SPINNER);
    const clear = () => {
      link.classList.remove("busy");
      link.querySelector(".spin")?.remove();
      window.removeEventListener("focus", clear);
    };
    window.addEventListener("focus", clear);
  });
})();
