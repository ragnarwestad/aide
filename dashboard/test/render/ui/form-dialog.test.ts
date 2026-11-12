// What the page script relies on in a dialog that holds a form: the posting
// form carries the hook it is posted by and its own refusal line, the
// affirmative is the form's first button (the one a press marks), and Cancel
// closes the dialog through a form of its own, with no id a script reads.
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { formDialog } from "../../../src/render/ui/components";

const parsed = (html: string): Document => {
  const win = new Window();
  win.document.body.innerHTML = html;
  return win.document as unknown as Document;
};

const buttonsOf = (form: Element): HTMLButtonElement[] => [...form.querySelectorAll("button")] as HTMLButtonElement[];

describe("formDialog", () => {
  test("the posting form carries its hook and a refusal line, Save is its first button and Cancel closes the dialog through a form of its own (AC-1)", () => {
    const doc = parsed(formDialog("en", {
      id: "new-thing", title: "New thing", action: "/api/things", hook: "actionform",
      data: { "thing-editor": "" }, fields: `<input name="name">`,
    }));
    const dialog = doc.querySelector<HTMLDialogElement>("dialog.formdialog#new-thing")!;
    const form = dialog.querySelector("#new-thing-form")!;
    expect(form.getAttribute("action")).toBe("/api/things");
    expect(form.classList.contains("actionform")).toBe(true);
    expect(form.hasAttribute("data-thing-editor")).toBe(true);
    expect(form.querySelector('input[name="name"]')).not.toBeNull();
    expect(form.querySelector(".refused")).not.toBeNull();
    expect(dialog.getAttribute("aria-labelledby")).toBe(form.querySelector("h2")!.id);

    const buttons = buttonsOf(form);
    expect(buttons[0]!.id).toBe("new-thing-form-save");
    const cancel = buttons.at(-1)!;
    const closes = doc.getElementById(cancel.getAttribute("form") ?? "")!;
    expect(closes.getAttribute("method")).toBe("dialog");
    expect(closes.closest("dialog")).toBe(dialog);
    expect(form.contains(closes)).toBe(false);
    // An id ending `-cancel` clears the page's unsaved-changes flag.
    expect(cancel.id).toBe("");
    expect(cancel.disabled).toBe(false);
  });

  test("an affirmative with a word of its own stays the form's first button, and what is handed as between stands before Cancel (AC-1)", () => {
    const doc = parsed(formDialog("en", {
      id: "add-thing", title: "Add thing", action: "/api/things", hook: "reloadform", fields: "",
      save: { label: "Add", pending: "Adding…" },
      between: `<button type="button" data-next>Next</button>`,
    }));
    const form = doc.querySelector("#add-thing-form")!;
    expect(form.classList.contains("reloadform")).toBe(true);
    const buttons = buttonsOf(form);
    expect(buttons).toHaveLength(3);
    expect(buttons[0]!.id).toBe("add-thing-form-save");
    expect(buttons[0]!.textContent).toBe("Add");
    expect(buttons[0]!.dataset.pending).toBe("Adding…");
    expect(buttons[1]!.hasAttribute("data-next")).toBe(true);
    expect(buttons[2]!.getAttribute("form")).toBe("add-thing-close");
  });
});
