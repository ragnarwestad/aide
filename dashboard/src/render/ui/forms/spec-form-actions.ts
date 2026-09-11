// Save and Cancel enable together the instant a field inside the form
// changes, and disable together again once Cancel restores the form to
// what it held when the page was opened (spec 391).
//
// Rendered-enabled-then-disabled-by-script, the same order
// `bindTypedConfirm` (`queue-client/forms.ts`) already uses for the
// opposite case: a button the server rendered `disabled` could never be
// enabled again without a script, and Save has to keep working with
// scripting off (REQ-7). Cancel renders `disabled` from the start —
// nothing asks it to work without this script.
//
// Keyed on `form.specform` — the only class the Checks tab's tick form
// and every document tab's save form share (`overview.ts`, `panels.ts`)
// — so this one script serves all five tabs with no per-tab branching.
//
// A ONE-WAY LATCH, not a continuous value comparison: the first
// `input`/`change` a field inside the form fires is enough to enable
// both controls, and nothing here re-reads a field's own content on
// every later keystroke — which is what lets the mounted WYSIWYG
// editor's own dirty signal (`spec-editor-client.ts`) stay a cheap,
// un-debounced re-dispatch rather than a call to its own
// `getMarkdown()` on every edit.
//
// Like `form-busy.ts`, this file can neither import nor export
// anything; test/render/ui/spec-form-actions.test.ts runs the
// transpiled source against a real DOM.

(() => {
  document.addEventListener("DOMContentLoaded", () => {
    // Every form on the page that carries the pair, not just the one:
    // the spec page has the Checks/document form AND the tracking form
    // above the tabs, and they save different things (spec 394).
    for (const prefix of ["specform", "trackingform", "settingsform"]) bind(prefix);
  });

  function bind(prefix: string): void {
    const form = document.querySelector(`form.${prefix}`) as HTMLFormElement | null;
    const save = document.getElementById(`${prefix}-save`) as HTMLButtonElement | null;
    const cancel = document.getElementById(`${prefix}-cancel`) as HTMLButtonElement | null;
    if (!form || !save || !cancel) return;

    const fields = (): (HTMLInputElement | HTMLTextAreaElement)[] =>
      Array.from(form.elements).filter(
        (el): el is HTMLInputElement | HTMLTextAreaElement => "name" in el && !!(el as HTMLInputElement).name,
      );
    // Taken once, at load — used only if Cancel is actually pressed
    // (the restore below), never for the dirty check, which is the
    // one-way latch and needs no snapshot of its own.
    const snapshot = fields().map((el) => ({
      el,
      value: el.value,
      checked: (el as HTMLInputElement).checked,
    }));

    const setDirty = (dirty: boolean): void => {
      save.disabled = !dirty;
      cancel.disabled = !dirty;
    };
    form.addEventListener("input", () => setDirty(true));
    form.addEventListener("change", () => setDirty(true));
    setDirty(false);

    cancel.addEventListener("click", () => {
      for (const { el, value, checked } of snapshot) {
        if (el.type === "checkbox" || el.type === "radio") (el as HTMLInputElement).checked = checked;
        else el.value = value;
      }
      // The WYSIWYG view a reader actually sees is a separate DOM tree
      // spec-editor-client.ts's editor library owns — this is the only
      // way to tell a mounted one "redraw from your textarea" from
      // outside it. A no-op where there is none (the Checks tab).
      form.querySelector(".spec-editor-raw")?.dispatchEvent(new Event("spec-cancel"));
      // Last: both controls go back to inactive, even if the redraw
      // above fired its own change event along the way.
      setDirty(false);
      // The chips the lift script moved follow their boxes back: it
      // listens for `change` on the document, and a restore is silent.
      // Unquoted attribute value, which CSS allows for an identifier:
      // quoted, the emitted script would contain the literal
      // `name="dependsOn"`, and the shell inlines this file in the page
      // head — where a test looking for that field would find the
      // script instead.
      for (const el of form.querySelectorAll("input[name=dependsOn]")) {
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      setDirty(false);
    });
  }
})();
