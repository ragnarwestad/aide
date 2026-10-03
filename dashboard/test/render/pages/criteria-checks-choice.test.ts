// The New spec form's choice of how strictly Analyze checks the spec's
// acceptance criteria: the stored values, in the order the select lists
// them, and what the form posts for them.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderNewSpecPage } from "../../../src/render";
import { criteriaChecksChoices } from "../../../src/render/pages/new-spec-page/options-tab.ts";

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

/** What the form posts under `criteriaChecks`. */
function posted(form: HTMLFormElement): FormDataEntryValue | null {
  const FormDataCtor = (form.ownerDocument.defaultView as unknown as { FormData: typeof FormData }).FormData;
  return new FormDataCtor(form).get("criteriaChecks");
}

describe("the criteria checks choice", () => {
  test("offers Off, Warn and Stop, in that order (AC-2)", () => {
    expect(criteriaChecksChoices()).toEqual([
      { value: "off", label: "Off" },
      { value: "warn", label: "Warn" },
      { value: "stop", label: "Stop" },
    ]);
  });

  test("an untouched New spec form posts off (AC-2)", () => {
    expect(posted(newSpecForm())).toBe("off");
  });

  test("a New spec form with Stop chosen posts stop (AC-2)", () => {
    const form = newSpecForm();
    const select = form.querySelector("#new-spec-criteria-checks") as HTMLSelectElement;
    select.value = "stop";
    expect(posted(form)).toBe("stop");
  });
});
