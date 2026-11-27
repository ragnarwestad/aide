// The New spec form's "Let me choose the approach" box: what the form
// posts for it when ticked.

import { describe, expect, test } from "bun:test";
import { renderNewSpecPage } from "../../../src/render";
import { documents } from "./fixtures.ts";

const parse = documents();

/** The New spec form as the page draws it. */
function newSpecForm(): HTMLFormElement {
  const page = parse(renderNewSpecPage([], "2026-10-03T00:00:00Z", { createProjects: ["aide"] }));
  return page.getElementById("new-spec-form") as unknown as HTMLFormElement;
}

/** What the form posts under `chooseApproach`. */
function posted(form: HTMLFormElement): FormDataEntryValue | null {
  const FormDataCtor = (form.ownerDocument.defaultView as unknown as { FormData: typeof FormData }).FormData;
  return new FormDataCtor(form).get("chooseApproach");
}

describe("the Let me choose the approach box", () => {
  test("ticked, the form posts 1", () => {
    const form = newSpecForm();
    (form.ownerDocument.querySelector('[name="chooseApproach"]') as HTMLInputElement).checked = true;
    expect(posted(form)).toBe("1");
  });
});
