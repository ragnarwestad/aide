// The New spec page's two tabs, Spec and Options: which one the address
// opens, that both stay in the one form so a press posts what either
// holds, and the tab words in the reader's language.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderNewSpecPage, type NewSpecPageOptions } from "../../../src/render";
import { t } from "../../../src/i18n";

const windows: Window[] = [];
afterEach(async () => {
  while (windows.length) await windows.pop()!.happyDOM.close();
});

/** The New spec page as the server draws it, in a document. */
function page(opts: Partial<NewSpecPageOptions> = {}): Document {
  const win = new Window();
  windows.push(win);
  win.document.write(renderNewSpecPage([], "2026-10-03T00:00:00Z", { createProjects: ["aide"], ...opts }));
  return win.document as unknown as Document;
}

const panel = (doc: Document, key: string) => doc.querySelector(`[data-tab-panel="${key}"]`) as HTMLElement | null;

describe("which tab the New spec page opens", () => {
  test.each([
    ["options", "options"],
    ["spec", "spec"],
    [undefined, "spec"],
    ["nonsense", "spec"],
  ] as const)("tab %p opens %s, and the other panel is hidden", (tab, open) => {
    const doc = page({ tab });
    const shut = open === "spec" ? "options" : "spec";
    expect(panel(doc, open)?.hasAttribute("hidden")).toBe(false);
    expect(panel(doc, shut)?.hasAttribute("hidden")).toBe(true);
  });
});

describe("what the New spec form posts", () => {
  test("an untouched Options tab posts the same names and values as before", () => {
    const doc = page({ modelChoices: [{ name: "sonnet" }, { name: "fable" }] });
    expect(panel(doc, "options")?.hasAttribute("hidden")).toBe(true);
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
        ["aiFormulateAcceptance", "1"],
        ["criteriaChecks", "off"],
        ["steps", "analyze"],
        ["steps", "implement"],
        ["steps", "archive"],
        ["model.create", "sonnet"],
        ["model.analyze", "sonnet"],
        ["model.implement", "sonnet"],
        ["model.archive", "sonnet"],
      ].sort(),
    );
  });
});

describe("the tab words", () => {
  test("a Norwegian page names its tabs from the Norwegian catalogue", () => {
    const doc = page({ lang: "nb" });
    const words = [...doc.querySelectorAll("nav[data-new-spec-tabs] a.tab")].map((a) => a.textContent);
    expect(words).toStrictEqual([t("nb", "newSpec.tabSpec"), t("nb", "newSpec.tabOptions")]);
  });
});
