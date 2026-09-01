// A link that leaves this page for another document says so the moment
// it is clicked, on every page (spec 312) — the second half of the
// promise `form-busy.ts` keeps for a pressed Save.
//
// It used to be `queue-client.ts`'s own `markGoing()`, bound only in
// that bundle, which only the Specs list page loads. Moved here so it
// runs wherever `pageShell` does — the spec page's own tabs among them,
// two of which (Checks, Logs) load no page script of their own at all.
//
// It does NOT `preventDefault()`. There is nothing to intercept: the
// browser's own navigation is correct, and re-implementing a page load
// in script to get a spinner would be a bad trade — the only thing
// wrong was that the click was invisible.
//
// Like `form-busy.ts`, this file can neither import nor export
// anything; `test/render/ui/nav-busy.test.ts` runs it against a fake
// document.

(() => {
  document.addEventListener("click", (event: Event) => {
    const e = event as MouseEvent;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const link = (e.target as Element | null)?.closest?.("a[data-goto]") as HTMLAnchorElement | null;
    link?.classList.add("awaiting");
  });
})();
