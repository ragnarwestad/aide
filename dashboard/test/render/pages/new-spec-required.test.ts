// The New spec form cannot be sent without a project and a title: the
// browser refuses the empty field before anything is posted.
import { expect, test } from "bun:test";
import { renderNewSpecPage } from "../../../src/render";
import { documents } from "./fixtures.ts";

const parse = documents();

/** The New spec form as the server draws it, with title and description filled in. */
function filled(): HTMLFormElement {
  const doc = parse(renderNewSpecPage([], "2026-10-03T00:00:00Z", { createProjects: ["aide"] }));
  const form = doc.getElementById("new-spec-form") as HTMLFormElement;
  (form.querySelector('input[name="title"]') as HTMLInputElement).value = "A title";
  (form.querySelector('textarea[name="description"]') as HTMLTextAreaElement).value = "A description";
  return form;
}

test("a form with no project chosen is not valid, at the project field", () => {
  const form = filled();
  expect((form.querySelector('select[name="project"]') as HTMLSelectElement).validity.valueMissing).toBe(true);
  expect(form.checkValidity()).toBe(false);
  (form.querySelector('select[name="project"]') as HTMLSelectElement).value = "aide";
  expect(form.checkValidity()).toBe(true);
});

test("a form with an empty title is not valid, at the title field", () => {
  const form = filled();
  (form.querySelector('select[name="project"]') as HTMLSelectElement).value = "aide";
  const title = form.querySelector('input[name="title"]') as HTMLInputElement;
  title.value = "";
  expect(title.validity.valueMissing).toBe(true);
  expect(form.checkValidity()).toBe(false);
});
