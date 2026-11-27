import { describe, expect, test } from "bun:test";
import { renderNewSpecPage, type NewSpecPageOptions } from "../../../src/render";
import { documents } from "./fixtures.ts";

const parse = documents();

/** The New spec page as the server draws it, in a document. */
function page(opts: Partial<NewSpecPageOptions> = {}): Document {
  return parse(renderNewSpecPage([], "2026-10-03T00:00:00Z", { createProjects: ["aide"], ...opts }));
}

describe("what the New spec form posts", () => {
  test("an untouched New spec form posts only the three spec settings (AC-5)", () => {
    const doc = page({ modelChoices: [{ name: "sonnet" }, { name: "fable" }] });
    const form = doc.getElementById("new-spec-form") as HTMLFormElement;
    (form.querySelector('input[name="title"]') as HTMLInputElement).value = "A title";
    (form.querySelector('textarea[name="description"]') as HTMLTextAreaElement).value = "A description";
    const FormDataCtor = (doc.defaultView as unknown as { FormData: typeof FormData }).FormData;
    const posted = [...new FormDataCtor(form).entries()].map(([name, value]) => [name, String(value)]);
    expect(posted.sort()).toEqual(
      [
        ["project", ""],
        ["title", "A title"],
        ["description", "A description"],
        ["acceptanceRequired", "1"],
        ["criteriaChecks", "off"],
      ].sort(),
    );
  });
});
