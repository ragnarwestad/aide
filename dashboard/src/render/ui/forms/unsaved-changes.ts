import { FORM_SAVED, PAGE_DRAWN, PAGE_LEAVE, TRACKED_FORM_SELECTOR } from "../../../page-contract.ts";

// A native "leave this page?" confirmation, armed the instant a field
// inside one of the tracked forms changes, and disarmed for that form the
// instant its own Save/Create is submitted or its Cancel is pressed. Each
// form is guarded on its own: a page with two forms open (a project's two
// settings cards) still asks while the other one holds edits. A form with
// `data-dirty-until-saved` stays guarded through its submit until the page
// script says the Save went through (`FORM_SAVED`), so a refused Save
// still asks.
// Reachable by every means a page can be left — an in-app
// link, the browser's Back/Forward, a closed tab, a typed address —
// because it rides the browser's own `beforeunload` event rather than
// intercepting any one of those individually.
//
// A ONE-WAY LATCH per form, not a continuous value comparison — the same shape
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
  const TRACKED = TRACKED_FORM_SELECTOR;
  /** The tracked forms holding edits. */
  const dirty = new Set<Element>();
  const isDirty = (): boolean => dirty.size > 0;

  const markDirty = (event: Event): void => {
    const target = event.target as Element | null;
    const own = target?.closest?.(TRACKED);
    if (!own) return;
    if (target!.closest("[data-unit-choice]")) return;
    // A field that names a form other than a tracked one is saved some
    // other way: the phase table's AI and model are saved the moment
    // they are picked.
    const named = target!.getAttribute?.("form");
    const form = named ? document.getElementById(named)?.closest?.(TRACKED) : own;
    if (!form) return;
    dirty.add(form);
  };

  document.addEventListener("input", markDirty);
  document.addEventListener("change", markDirty);

  // Save: any submit of a tracked form, which the page script posts
  // (settings-page.ts, the document tabs).
  document.addEventListener("submit", (event: Event) => {
    const form = (event.target as Element | null)?.closest?.(TRACKED);
    if (form && !form.hasAttribute?.("data-dirty-until-saved")) dirty.delete(form);
  });
  document.addEventListener(FORM_SAVED, (event: Event) => {
    const form = (event.target as Element | null)?.closest?.(TRACKED);
    if (form) dirty.delete(form);
  });

  // Cancel: the existing `${prefix}-cancel` id convention, plus
  // `data-discard-changes` on a Cancel link that has no such id. A Cancel
  // inside a tracked form disarms that form; one outside every form, all.
  //
  // An in-app link click while dirty is an exit path a page's own
  // script CAN intercept — a closed tab, a typed address and a
  // Back/Forward the in-place swap does not take still fall to the
  // native beforeunload prompt below.
  // The `leaveapp` dialog (shell.ts) is a real <dialog>, always positioned
  // inside the document's own viewport rather than by the OS, unlike
  // that native prompt. Registered before NAV_BUSY_SCRIPT/
  // NAV_OVERLAY_SCRIPT in shell.ts's own script concatenation, so this
  // listener's preventDefault() is seen by both before either adds its
  // own busy-indicator side effect: same-type listeners on one element
  // run in the order they were added.
  //
  // Back/Forward through the in-place page swap asks the same dialog, by
  // `aide-page-leave` (page-swap/index.ts): `ask()` tells the swap to wait
  // for the answer, which arrives as `proceed()` or `stay()`. One dialog,
  // one `close` listener, and the navigation that opened it last owns the
  // answer: an older swap is told `drop()`, and an older link is forgotten.
  type LeaveDetail = { ask(): void; proceed(): void; stay(): void; drop(): void };
  type Pending = { link: HTMLAnchorElement } | { swap: LeaveDetail };
  let pending: Pending | null = null;
  let dialogWired = false;

  const answer = (dialog: HTMLDialogElement): void => {
    const p = pending;
    pending = null;
    const leave = dialog.returnValue === "leave";
    if (leave) dirty.clear();
    // The link itself is pressed again, now that nothing is dirty, so it
    // leaves the way it always would — `rel="noreferrer"` on Back
    // included, which an assigned address would lose.
    if (p && "link" in p) {
      if (leave) p.link.click();
    } else if (p) {
      if (leave) p.swap.proceed();
      else p.swap.stay();
    }
  };

  const openFor = (dialog: HTMLDialogElement, next: Pending): void => {
    if (pending && "swap" in pending) pending.swap.drop();
    pending = next;
    if (!dialogWired) {
      dialogWired = true;
      dialog.addEventListener("close", () => answer(dialog));
    }
    if (!dialog.open) {
      // Escape closes a dialog without setting its value, so an OK left
      // over from an earlier opening must not answer this one.
      dialog.returnValue = "";
      dialog.showModal();
    }
  };

  const leaveDialog = (): HTMLDialogElement | null => {
    const dialog = document.getElementById("leaveapp") as HTMLDialogElement | null;
    return dialog && typeof dialog.showModal === "function" ? dialog : null;
  };

  document.addEventListener("click", (event: Event) => {
    const target = event.target as Element | null;
    if (target?.closest?.("[id$='-cancel'], [data-discard-changes]")) {
      const own = target.closest(TRACKED);
      if (own) dirty.delete(own);
      else dirty.clear();
      return;
    }
    if (!isDirty()) return;
    const e = event as MouseEvent;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const link = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
    const href = link.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    const dialog = leaveDialog();
    if (!dialog) return;
    event.preventDefault();
    openFor(dialog, { link });
  });

  document.addEventListener(PAGE_LEAVE, (event: Event) => {
    if (!isDirty()) return;
    const dialog = leaveDialog();
    if (!dialog) return;
    event.preventDefault();
    const swap = (event as CustomEvent<LeaveDetail>).detail;
    swap.ask();
    openFor(dialog, { swap });
  });
  document.addEventListener(PAGE_DRAWN, () => { dirty.clear(); });

  window.addEventListener("beforeunload", (event: BeforeUnloadEvent) => {
    if (!isDirty()) return;
    // preventDefault() alone asks for the browser's own prompt;
    // returnValue is the deprecated way to ask for the same thing.
    event.preventDefault();
  });
})();
