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
  ] as const)("tab %p opens %s, and the other panel is hidden (AC-1)", (tab, open) => {
    const doc = page({ tab });
    const shut = open === "spec" ? "options" : "spec";
    expect(panel(doc, open)?.hasAttribute("hidden")).toBe(false);
    expect(panel(doc, shut)?.hasAttribute("hidden")).toBe(true);
  });
});

describe("what the New spec form posts", () => {
  test("it carries the Spec tab's fields and the hidden Options tab's choices (AC-6)", () => {
    const doc = page();
    expect(panel(doc, "options")?.hasAttribute("hidden")).toBe(true);
    const form = doc.getElementById("new-spec-form") as HTMLFormElement;
    (form.querySelector('input[name="title"]') as HTMLInputElement).value = "A title";
    (form.querySelector('textarea[name="description"]') as HTMLTextAreaElement).value = "A description";
    const FormDataCtor = (doc.defaultView as unknown as { FormData: typeof FormData }).FormData;
    const data = new FormDataCtor(form);
    expect(data.get("title")).toBe("A title");
    expect(data.get("description")).toBe("A description");
    expect(data.get("criteriaChecks")).toBe("off");
    expect(data.get("acceptanceRequired")).toBe("1");
    expect(data.get("aiFormulateAcceptance")).toBe("1");
    expect(data.getAll("steps").length).toBeGreaterThan(0);
  });
});

describe("the tab words", () => {
  test("a Norwegian page names its tabs from the Norwegian catalogue (AC-7)", () => {
    const doc = page({ lang: "nb" });
    const words = [...doc.querySelectorAll("nav[data-new-spec-tabs] a.tab")].map((a) => a.textContent);
    expect(words).toStrictEqual([t("nb", "newSpec.tabSpec"), t("nb", "newSpec.tabOptions")]);
  });
});
