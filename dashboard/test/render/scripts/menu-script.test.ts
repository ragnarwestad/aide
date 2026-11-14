import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Window } from "happy-dom";

const built = await Bun.build({
  entrypoints: [join(import.meta.dir, "..", "..", "..", "src", "render", "scripts", "menu-script.ts")],
  target: "browser", format: "iife",
});
if (!built.success) throw new AggregateError(built.logs, "menu-script.ts failed to bundle");
const SOURCE = await built.outputs[0]!.text();

/** A page with an open "…" menu whose row names `opens`, and a shut
 *  `<details>` with the id `state-filter` and a link in its panel. */
function page(opens: string) {
  const window = new Window();
  window.document.body.innerHTML =
    `<details class="menu" id="more" open><summary>…</summary><div class="menupanel">` +
    `<button type="button" data-opens="${opens}">Filter</button></div></details>` +
    `<details class="menu state" id="state-filter"><summary>All</summary>` +
    `<div class="menupanel"><a href="/?state=all">All</a></div></details>`;
  new Function("document", "window", "sessionStorage", "HTMLDialogElement", "HTMLDetailsElement", SOURCE)(
    window.document, window, window.sessionStorage, window.HTMLDialogElement, window.HTMLDetailsElement,
  );
  const doc = window.document;
  const more = doc.getElementById("more") as unknown as HTMLDetailsElement;
  const filter = doc.getElementById("state-filter") as unknown as HTMLDetailsElement;
  const row = doc.querySelector("[data-opens]") as unknown as HTMLButtonElement;
  return { doc, more, filter, row };
}

describe("menu script: a row that opens another panel", () => {
  test("shuts the … menu, opens the panel it names and focuses its first link (AC-2, AC-5)", () => {
    const { doc, more, filter, row } = page("state-filter");
    row.click();
    expect(more.open).toBe(false);
    expect(filter.open).toBe(true);
    expect(doc.activeElement).toBe(doc.querySelector("#state-filter a")!);
  });

  test("a row naming an id the page does not have shuts the menus and opens nothing (AC-2, AC-5)", () => {
    const { more, filter, row } = page("missing");
    expect(() => row.click()).not.toThrow();
    expect(more.open).toBe(false);
    expect(filter.open).toBe(false);
  });
});
