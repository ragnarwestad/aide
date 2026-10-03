// The New spec form's "Let me choose the approach" box: what the form
// posts for it, untouched and ticked.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderNewSpecPage } from "../../../src/render";

const windows: Window[] = [];
afterEach(async () => {
  while (windows.length) await windows.pop()!.happyDOM.close();
});

/** The New spec form as the page draws it. */
function newSpecForm(): HTMLFormElement {
  const win = new Window();
  windows.push(win);
  win.document.write(renderNewSpecPage([], "2026-10-03T00:00:00Z", { createProjects: ["aide"] }));
  return win.document.getElementById("new-spec-form") as unknown as HTMLFormElement;
}

/** What the form posts under `chooseApproach`. */
function posted(form: HTMLFormElement): FormDataEntryValue | null {
  const FormDataCtor = (form.ownerDocument.defaultView as unknown as { FormData: typeof FormData }).FormData;
  return new FormDataCtor(form).get("chooseApproach");
}

describe("the Let me choose the approach box", () => {
  test("an untouched New spec form posts nothing for it, so it is not ticked (AC-1)", () => {
    const form = newSpecForm();
    expect(form.querySelector('[name="chooseApproach"]')).not.toBeNull();
    expect(posted(form)).toBeNull();
  });

  test("ticked, the form posts 1 (AC-10)", () => {
    const form = newSpecForm();
    (form.ownerDocument.querySelector('[name="chooseApproach"]') as HTMLInputElement).checked = true;
    expect(posted(form)).toBe("1");
  });
});
