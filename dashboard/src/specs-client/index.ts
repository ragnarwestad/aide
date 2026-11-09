// The spec list's browser code. TypeScript like the rest of the
// repo — `tsc --noEmit` covers it, and the server bundles it on the way
// out (`specsClientScript`, `serve/serve-helpers.ts`).
//
// One rule, applied twice: never reload the page under a control
// someone is half-way through setting. That is why the table refreshes
// itself in place, and why every button on it posts from here rather
// than letting the browser navigate. Create is the one deliberate
// exception, and it is not one of "the buttons on it": it is on a page
// of its own with nothing to keep (see `submitCreate`).
//
// It used to have a second — answering the spec dropdown above the
// table, which had to update the step boxes, the "also touches" list
// and a summary line whenever the selection changed. Every spec has its
// own row-scoped control now, rendered by the server, so there is no
// selection left to react to and none of that code has a caller.
//
// This is the ENTRY POINT the bundler starts from (split specs-client.ts
// into a bundled folder): everything it USED to define inline now lives
// in src/specs-client/*.ts, themed by what it is rather than where it
// sits in one long file. What stays here is what is bound once for the
// whole document, which a page drawn in place keeps: the listeners on
// `document`, `body` and the window, and the clock. What a page needs
// bound is the one list in `page-mount/`, run here at load and again by
// the page swap for every page drawn in place.

import { openAsk } from "./ask.ts";
import { formatElapsed } from "./elapsed.ts";
import { bindLimits } from "./limits";
import { onVisibility } from "./live.ts";
import { bindPageSwap, swapPage } from "./page-swap";
import { mountPage } from "./page-mount";
import { placeNamedRow } from "./spec-detail";
import { followScheduleRow } from "./schedule-actions.ts";
import { submitProgress } from "./progress-dialog";
import { RELOAD_FORM, submitReloadForm } from "./reload-form";

// The count under every bounded text field follows what is typed, pasted and
// dropped, from listeners on the document. The counts themselves are drawn
// per page, by `mountPage` below.
bindLimits(document);

// Every confirmation asks in a dialog its button names: one click
// listener opens whichever it is, Cancel on a list row, Delete on a
// schedule entry and Remove project as well as Reopen and Close. One
// submit listener hands Reopen's and Close's OK to the wait, and posts
// every form the page loads again after (`reload-form/`). Delegated,
// so a list row drawn by a later redraw is reached too; on `body`, where
// bubbling reaches it before the spec editor's copy on `document` would —
// which is why that copy runs in the capture phase. `?.` since a
// stand-in document may have no body.
document.body?.addEventListener("click", openAsk as EventListener);
document.body?.addEventListener("submit", ((event: Event) => {
  const target = event.target as Element | null;
  const progress = target?.closest?.("form[data-progress]") as HTMLFormElement | null;
  if (progress) return submitProgress(progress, event);
  const reload = target?.closest?.(RELOAD_FORM) as HTMLFormElement | null;
  if (reload) return submitReloadForm(reload, event);
}) as EventListener);

// The marks are looked up fresh on every tick rather than bound once,
// which is what lets it survive `swapRows()` replacing `#jobrows`
// underneath it with no rebinding at all. See `specs-client/elapsed.ts`
// for `formatElapsed` itself and the hand-pairing it carries.
setInterval(() => {
  // A stamp it cannot read is left exactly as the server drew it:
  // "NaN" in a cell is worse than a figure that stopped moving.
  for (const el of document.querySelectorAll("[data-elapsed]")) {
    const mark = el as HTMLElement;
    const since = Date.parse(mark.dataset.elapsed ?? "");
    if (Number.isNaN(since)) continue;
    mark.textContent = formatElapsed(Date.now() - since);
  }
}, 1000);

// A schedule row is one big link to what its name links to, outside its
// own controls.
document.addEventListener("click", ((event: MouseEvent) => {
  followScheduleRow(event, (href) => {
    void swapPage(href, { history: "push" });
  });
}) as EventListener);

document.addEventListener("visibilitychange", onVisibility);
// An installed app coming back to the foreground can be restored from
// the browser's own back/forward cache instead of being drawn again, and
// that restore is a `pageshow` with no `visibilitychange` behind it. The
// same answer either way: fetch the rows, then make sure the stream is up.
if (typeof window !== "undefined") window.addEventListener("pageshow", onVisibility);

// A row the address names sits at the top of the list's box once the page
// has loaded, after the browser's own jump to the anchor.
const page = globalThis as unknown as Window;
page.addEventListener?.("load", () => placeNamedRow(document, page));

// Everything the page itself needs bound: now, and again for every page drawn in place.
let unmount = mountPage(document, { referrer: document.referrer });
bindPageSwap(document, {
  unmount: () => unmount(),
  mount: (referrer) => {
    unmount = mountPage(document, { referrer });
  },
});
