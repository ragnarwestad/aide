// A native "leave this page?" confirmation, armed the instant a field
// inside one of the tracked forms changes, and disarmed the instant
// that form's own Save/Create is submitted or its Cancel is pressed
// (spec 438). Reachable by every means a page can be left — an in-app
// link, the browser's Back/Forward, a closed tab, a typed address —
// because it rides the browser's own `beforeunload` event rather than
// intercepting any one of those individually.
//
// A ONE-WAY LATCH, not a continuous value comparison — the same shape
// spec-form-actions.ts uses, and for the same reason: the first
// input/change is enough, and nothing here re-reads a field's live
// content afterwards.
//
// `[data-unit-choice]` is skipped, since a Units radio is a display
// preference and not an edit to a form's content. The unit choice is
// drawn only in the header today, outside every form listed below, so
// nothing reaches that line.
//
// Like every other head script here, this file can neither import nor
// export anything; test/render/ui/forms/unsaved-changes.test.ts runs the
// transpiled source against a fake document and window.

(() => {
  const TRACKED = ".specform, .trackingform, .settingsform, .newspecform, .scheduleform";
  let dirty = false;

  const markDirty = (event: Event): void => {
    const target = event.target as Element | null;
    if (!target?.closest?.(TRACKED)) return;
    if (target.closest("[data-unit-choice]")) return;
    dirty = true;
  };

  document.addEventListener("input", markDirty);
  document.addEventListener("change", markDirty);

  // Save: any submit of a tracked form, whether AJAX-intercepted
  // (settings-page.ts) or left to the browser's own 303 redirect (the
  // document tabs).
  document.addEventListener("submit", (event: Event) => {
    const form = event.target as Element | null;
    if (form?.closest?.(TRACKED)) dirty = false;
  });

  // Cancel: the existing `${prefix}-cancel` id convention, plus
  // `data-discard-changes` on the one surface (project settings) that
  // has no such id.
  //
  // An in-app link click while dirty (spec 478) is the one exit path a
  // page's own script CAN intercept — Back/Forward, a closed tab and a
  // typed address still fall to the native beforeunload prompt below.
  // `dialog.leaveapp` (shell.ts) is a real <dialog>, always positioned
  // inside the document's own viewport rather than by the OS, unlike
  // that native prompt. Registered before NAV_BUSY_SCRIPT/
  // NAV_OVERLAY_SCRIPT in shell.ts's own script concatenation, so this
  // listener's preventDefault() is seen by both before either adds its
  // own busy-indicator side effect — the same reasoning
  // cancel-confirm.ts documents for a different pair of listeners.
  let pendingHref: string | null = null;
  let dialogWired = false;

  document.addEventListener("click", (event: Event) => {
    const target = event.target as Element | null;
    if (target?.closest?.("[id$='-cancel'], [data-discard-changes]")) {
      dirty = false;
      return;
    }
    if (!dirty) return;
    const e = event as MouseEvent;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const link = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
    const href = link.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    const dialog = document.querySelector("dialog.leaveapp") as HTMLDialogElement | null;
    if (!dialog || typeof dialog.showModal !== "function") return;
    if (!dialogWired) {
      dialogWired = true;
      dialog.addEventListener("close", () => {
        if (dialog.returnValue === "leave" && pendingHref) {
          dirty = false;
          window.location.href = pendingHref;
        }
        pendingHref = null;
      });
    }
    event.preventDefault();
    pendingHref = href;
    dialog.showModal();
  });

  window.addEventListener("beforeunload", (event: BeforeUnloadEvent) => {
    if (!dirty) return;
    // preventDefault() alone asks for the browser's own prompt;
    // returnValue is the deprecated way to ask for the same thing.
    event.preventDefault();
  });
})();
