// Save and Cancel enable together the instant a field inside `.specform`
// changes, and disable together again once Cancel restores it (spec
// 391) — `spec-form-actions.ts` can neither import nor export anything,
// so, like its siblings under ui/, it is transpiled and run here.
//
// Unlike form-busy.ts/nav-busy.ts/nav-overlay.ts, this script reads
// `form.elements`, snapshots real field values and relies on real
// event bubbling from a field up to its form — behaviour a hand-rolled
// fake document would have to reimplement faithfully, which is itself a
// correctness risk. `happy-dom` gives a REAL DOM instead, the same tool
// spec-editor-viewer-and-theme.test.ts already registers for a harder
// case (a real Toast UI Editor instance).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let scriptText: string;

beforeAll(async () => {
  const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
  GlobalRegistrator.register();
  scriptText = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
    readFileSync(join(import.meta.dir, "..", "..", "..", "src", "render", "ui", "spec-form-actions.ts"), "utf-8"),
  );
});

afterAll(async () => {
  const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
  await GlobalRegistrator.unregister();
});

beforeEach(() => {
  document.body.innerHTML = "";
});

/** A Checks-shaped form: a tick checkbox, and the Save/Cancel pair
 *  `saveCancelActions()` renders — Save enabled from the server, Cancel
 *  `disabled` (REQ-7's own shape, proven separately at the render
 *  layer; this file only proves what the SCRIPT then does to them). */
function checksForm(): { form: HTMLFormElement; tick: HTMLInputElement } {
  document.body.innerHTML =
    `<form class="specform" method="post">` +
    `<input type="hidden" name="checksPhase" value="Acceptance criteria">` +
    `<label><input type="checkbox" name="tick" value="row one"></label>` +
    `<button id="specform-save" type="submit">Save</button>` +
    `<button id="specform-cancel" type="button" disabled>Cancel</button>` +
    `</form>`;
  return {
    form: document.querySelector("form.specform") as HTMLFormElement,
    tick: document.querySelector('input[name="tick"]') as HTMLInputElement,
  };
}

/** A document-tab-shaped form: a textarea, plus the same pair, plus the
 *  raw editor textarea `spec-editor-client.ts` would sync — dispatching
 *  "spec-cancel" on it is the redraw hook this script owns; whether an
 *  editor is actually mounted is spec-editor-client.ts's own concern
 *  (spec-editor-viewer-and-theme.test.ts). */
function documentForm(initialText: string): { form: HTMLFormElement; raw: HTMLTextAreaElement } {
  document.body.innerHTML =
    `<form method="post" class="newspecform specform">` +
    `<input type="hidden" name="file" value="2-analysis.md">` +
    `<textarea name="text" class="spec-editor-raw">${initialText}</textarea>` +
    `<button id="specform-save" type="submit">Save</button>` +
    `<button id="specform-cancel" type="button" disabled>Cancel</button>` +
    `</form>`;
  return {
    form: document.querySelector("form.specform") as HTMLFormElement,
    raw: document.querySelector(".spec-editor-raw") as HTMLTextAreaElement,
  };
}

/** A Settings-shaped form (spec 409): one text-ish field, plus the same
 *  Save/Cancel pair, under the third registered prefix. Spec 414 adds
 *  the Units radios as a literal descendant, the same shape
 *  settings-page.ts now renders, to prove the two dirty-latch guards
 *  scoped to `[data-unit-choice]`. */
function settingsForm(): { form: HTMLFormElement; input: HTMLInputElement; unitRadio: HTMLInputElement } {
  document.body.innerHTML =
    `<form id="settings-form" class="settingsform" method="post">` +
    `<input type="number" name="budgetUsd" value="3">` +
    `<p class="row"><span class="lbl">Units</span>` +
    `<label><input type="radio" name="unit" value="usd" data-unit-choice="usd" checked> $</label>` +
    `<label><input type="radio" name="unit" value="tokens" data-unit-choice="tokens"> Tokens</label>` +
    `</p>` +
    `<button id="settingsform-save" type="submit">Save</button>` +
    `<button id="settingsform-cancel" type="button" disabled>Cancel</button>` +
    `</form>`;
  return {
    form: document.querySelector("form.settingsform") as HTMLFormElement,
    input: document.querySelector('input[name="budgetUsd"]') as HTMLInputElement,
    unitRadio: document.querySelector('input[data-unit-choice="tokens"]') as HTMLInputElement,
  };
}

/** Mounts the script and fires DOMContentLoaded — the event this script
 *  waits for before touching any element, exactly as `theme-script.ts`
 *  and the shell's other head scripts do. */
function mount(): void {
  new Function(scriptText)();
  document.dispatchEvent(new Event("DOMContentLoaded"));
}

function save(): HTMLButtonElement {
  return document.getElementById("specform-save") as HTMLButtonElement;
}
function cancel(): HTMLButtonElement {
  return document.getElementById("specform-cancel") as HTMLButtonElement;
}

describe("REQ-2/REQ-9: Save is inactive until the form has seen an edit", () => {
  test("Save starts disabled once the script runs, even though the server rendered it enabled", () => {
    checksForm();
    expect(save().disabled).toBe(false);
    mount();
    expect(save().disabled).toBe(true);
  });

  test("a checkbox toggle enables Save immediately — the first event is enough", () => {
    const { tick } = checksForm();
    mount();
    tick.checked = true;
    tick.dispatchEvent(new Event("change", { bubbles: true }));
    expect(save().disabled).toBe(false);
  });

  test("a textarea edit enables Save immediately, with no debounce", () => {
    const { form } = documentForm("old text");
    mount();
    const textarea = form.querySelector("textarea")!;
    textarea.value = "new text";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    expect(save().disabled).toBe(false);
  });

  test("no form on the page: the script does nothing and throws nothing", () => {
    document.body.innerHTML = "<p>no form here</p>";
    expect(() => mount()).not.toThrow();
  });
});

describe("REQ-3/REQ-10: Cancel mirrors Save's disabled state exactly", () => {
  test("Cancel starts disabled with Save, and enables with it on the same edit", () => {
    const { tick } = checksForm();
    mount();
    expect(cancel().disabled).toBe(true);
    tick.checked = true;
    tick.dispatchEvent(new Event("change", { bubbles: true }));
    expect(cancel().disabled).toBe(false);
  });
});

describe("REQ-4/REQ-10: Cancel restores every field and re-disables both controls", () => {
  test("a ticked checkbox reverts to unticked, and both controls go inactive again", () => {
    const { tick } = checksForm();
    mount();
    tick.checked = true;
    tick.dispatchEvent(new Event("change", { bubbles: true }));
    expect(save().disabled).toBe(false);

    cancel().dispatchEvent(new Event("click", { bubbles: true }));

    expect(tick.checked).toBe(false);
    expect(save().disabled).toBe(true);
    expect(cancel().disabled).toBe(true);
  });

  test("a changed textarea reverts to its loaded value, and both controls go inactive again", () => {
    const { form } = documentForm("original");
    mount();
    const textarea = form.querySelector("textarea")!;
    textarea.value = "edited";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    expect(save().disabled).toBe(false);

    cancel().dispatchEvent(new Event("click", { bubbles: true }));

    expect(textarea.value).toBe("original");
    expect(save().disabled).toBe(true);
    expect(cancel().disabled).toBe(true);
  });

  test("Cancel dispatches spec-cancel on the raw editor textarea, so a mounted editor can redraw", () => {
    const { form, raw } = documentForm("original");
    mount();
    const textarea = form.querySelector("textarea")!;
    textarea.value = "edited";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    let heard = false;
    raw.addEventListener("spec-cancel", () => {
      heard = true;
    });
    cancel().dispatchEvent(new Event("click", { bubbles: true }));
    expect(heard).toBe(true);
  });

  test("a spec-cancel listener that itself fires a change event does not leave the controls dirty", () => {
    // Reproduces spec-editor-client.ts's own addition: instance.setMarkdown()
    // inside the "spec-cancel" handler may re-dispatch a bubbling "input"
    // on the raw textarea. The Cancel handler's own setDirty(false) has
    // to be the LAST word regardless of what a listener in between did.
    const { form, raw } = documentForm("original");
    mount();
    raw.addEventListener("spec-cancel", () => {
      raw.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const textarea = form.querySelector("textarea")!;
    textarea.value = "edited";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    cancel().dispatchEvent(new Event("click", { bubbles: true }));

    expect(save().disabled).toBe(true);
    expect(cancel().disabled).toBe(true);
  });

  test("a Checks-shaped form (no editor) cancels with no error", () => {
    const { tick } = checksForm();
    mount();
    tick.checked = true;
    tick.dispatchEvent(new Event("change", { bubbles: true }));
    expect(() => cancel().dispatchEvent(new Event("click", { bubbles: true }))).not.toThrow();
  });
});

describe("REQ-5/REQ-10: Cancel writes nothing", () => {
  test("pressing Cancel fires no submit event", () => {
    const { tick, form } = checksForm();
    mount();
    tick.checked = true;
    tick.dispatchEvent(new Event("change", { bubbles: true }));
    let submitted = false;
    form.addEventListener("submit", () => {
      submitted = true;
    });
    cancel().dispatchEvent(new Event("click", { bubbles: true }));
    expect(submitted).toBe(false);
  });
});

// Spec 409, REQ-9: a third form, "settingsform", gets the exact same
// dirty latch every `.specform`/`.trackingform` already has — nothing
// new to prove about the mechanism itself, only that this prefix is
// actually registered in the bind() loop.
describe("spec 409: the settingsform prefix gets the same dirty latch", () => {
  test("Save/Cancel enable on an edit, and Cancel restores the field and re-disables both", () => {
    const { input } = settingsForm();
    mount();
    const save = document.getElementById("settingsform-save") as HTMLButtonElement;
    const cancel = document.getElementById("settingsform-cancel") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);

    input.value = "8";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(save.disabled).toBe(false);
    expect(cancel.disabled).toBe(false);

    cancel.dispatchEvent(new Event("click", { bubbles: true }));
    expect(input.value).toBe("3");
    expect(save.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
  });
});

// Spec 414: Units becomes a literal descendant of the settings form for
// layout alone — a page-wide display preference (unit-script.ts,
// localStorage), not a field this form saves, so it must keep the
// guarantee spec 409 gave it by DOM position, now via the two
// `closest("[data-unit-choice]")` guards in bind().
describe("spec 414: Units rides inside settingsform without becoming dirty-tracked", () => {
  test("flipping the Units radio never enables Save/Cancel", () => {
    const { unitRadio } = settingsForm();
    mount();
    const save = document.getElementById("settingsform-save") as HTMLButtonElement;
    const cancel = document.getElementById("settingsform-cancel") as HTMLButtonElement;

    unitRadio.checked = true;
    unitRadio.dispatchEvent(new Event("change", { bubbles: true }));

    expect(save.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
  });

  test("Cancel restores a tracked field but leaves a flipped Units radio exactly as the user set it", () => {
    const { input, unitRadio } = settingsForm();
    mount();
    const save = document.getElementById("settingsform-save") as HTMLButtonElement;
    const cancel = document.getElementById("settingsform-cancel") as HTMLButtonElement;

    input.value = "8";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    unitRadio.checked = true;
    unitRadio.dispatchEvent(new Event("change", { bubbles: true }));
    expect(save.disabled).toBe(false);

    cancel.dispatchEvent(new Event("click", { bubbles: true }));

    expect(input.value).toBe("3");
    expect(unitRadio.checked).toBe(true);
    expect(save.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
  });
});
