// A settings field is as wide as its Value cell, at every width, and the
// narrow stylesheet no longer carries a second rule for `input`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../../../src/render/ui/css/${f}`, import.meta.url), "utf8");
const list = read("list.css");
const narrow = read("narrow.css");

describe("config fields fill their cell", () => {
  test("one rule sets the width on the Value cell's textarea and select, outside every media query (AC-1)", () => {
    const m = /table\.list td\[data-col="setting-value"\] :is\(textarea, select\) \{([^}]*)\}/.exec(list);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/width: 100%/);
    expect(m![1]).toMatch(/box-sizing: border-box/);
    expect(list.slice(0, m!.index)).not.toMatch(/@media[^{]*\{[^}]*$/);
  });

  test("narrow.css has no rule naming input for the settings table (AC-1)", () => {
    expect(narrow).not.toMatch(/setting-name[^{]*:is\(input/);
  });

  test("the textarea takes the cell's look and no handle (AC-1)", () => {
    const m = /table\.list td\[data-col="setting-value"\] textarea \{([^}]*)\}/.exec(list)![1]!;
    expect(m).toMatch(/resize: none/);
    expect(m).toMatch(/font: inherit/);
    expect(m).not.toMatch(/appearance/);
  });
});
