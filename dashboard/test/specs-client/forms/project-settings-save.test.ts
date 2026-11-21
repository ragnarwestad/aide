// What a successful Save of one Config card does to the page: with the other
// card holding edits the page stays, the saved card's fields take their new
// values as saved, and only that card is told it is saved; with no other
// edits the Config tab is drawn afresh.
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { FORM_SAVED } from "../../../src/page-contract.ts";
import { settingsSaved } from "../../../src/specs-client/forms.ts";

function page() {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML =
    `<form class="pageform projectsettingsform" id="config"><textarea name="specsPath">specs</textarea></form>` +
    `<form class="pageform projectsettingsform" id="manifest"><textarea name="testCmd">make test</textarea>` +
    `<select name="codeLanding"><option value="merge" selected>Merge</option><option value="pr">PR</option></select>` +
    `<span class="refused">That path is not a full path</span></form>`;
  const config = document.getElementById("config") as unknown as HTMLFormElement;
  const manifest = document.getElementById("manifest") as unknown as HTMLFormElement;
  const saved: string[] = [];
  document.addEventListener(FORM_SAVED, (e) => saved.push((e.target as unknown as HTMLElement).id));
  const field = (form: HTMLFormElement, name: string) => form.querySelector(`[name="${name}"]`) as HTMLTextAreaElement & HTMLSelectElement;
  return { config, manifest, saved, field };
}

describe("a successful Save of one settings card", () => {
  test("while the other card holds edits, keeps the page and those edits, and the saved card's values become its saved ones (AC-9)", async () => {
    const p = page();
    p.field(p.config, "specsPath").value = "typed/specs";
    p.field(p.manifest, "testCmd").value = "bun test";
    p.field(p.manifest, "codeLanding").value = "pr";
    let swapped = false;
    await settingsSaved(p.manifest, async () => { swapped = true; });
    expect(swapped).toBe(false);
    expect(p.field(p.config, "specsPath").value).toBe("typed/specs");
    expect(p.field(p.manifest, "testCmd").defaultValue).toBe("bun test");
    p.manifest.reset();
    expect(p.field(p.manifest, "testCmd").value).toBe("bun test");
    expect(p.field(p.manifest, "codeLanding").value).toBe("pr");
    expect(p.saved).toEqual(["manifest"]);
    expect(p.manifest.querySelector(".refused")!.textContent).toBe("");
  });

  test("with no other card changed, draws the Config tab afresh, told it is saved first (AC-9)", async () => {
    const p = page();
    p.field(p.manifest, "testCmd").value = "bun test";
    const order: string[] = [];
    p.manifest.ownerDocument.addEventListener(FORM_SAVED, () => order.push("saved"));
    await settingsSaved(p.manifest, async () => { order.push("swap"); });
    expect(order).toEqual(["saved", "swap"]);
  });
});
