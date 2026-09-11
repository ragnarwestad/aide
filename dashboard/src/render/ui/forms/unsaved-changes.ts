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
// `[data-unit-choice]` is excluded the same way spec-form-actions.ts
// excludes it: the page-wide Units radio sits inside these same forms
// but is not an edit to their own content.
//
// Like every other head script here, this file can neither import nor
// export anything; test/render/ui/unsaved-changes.test.ts runs the
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
  document.addEventListener("click", (event: Event) => {
    const target = event.target as Element | null;
    if (target?.closest?.("[id$='-cancel'], [data-discard-changes]")) dirty = false;
  });

  window.addEventListener("beforeunload", (event: BeforeUnloadEvent) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
})();
