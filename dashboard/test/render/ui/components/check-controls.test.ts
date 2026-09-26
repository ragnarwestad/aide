// The boxes of one acceptance row and the heading over them: the rule, once.
// The Status tab and the Specs list only prove they are wired to it.

import { describe, expect, test } from "bun:test";
import { checkColumns, checkControls, checkReadOnlyMark } from "../../../../src/render/ui/check-controls.ts";

const LINE = "| AC-1: it folds | ⬜ | |";
const row = { line: LINE, done: false };

describe("the two boxes of a live row", () => {
  const html = checkControls(row, "en");

  test("both are label.checkbox slots with the row's verbatim line, and no visible word (AC-1)", () => {
    expect(html).toContain(`<label class="checkbox"><input type="checkbox" name="tick" value="${LINE}"`);
    expect(html).toContain(`<label class="checkbox unverified"><input type="checkbox" name="unverified" value="${LINE}"`);
    expect(html).toContain(`<input type="hidden" name="row" value="${LINE}">`);
    expect(html).not.toContain("Not verified");
    expect(html).not.toMatch(/<\/label>[^<]/);
  });

  test("each box is named by the heading's two lines (AC-2)", () => {
    expect(html).toContain('name="tick" value="| AC-1: it folds | ⬜ | |" aria-label="Verified: Yes">');
    expect(html).toContain('name="unverified" value="| AC-1: it folds | ⬜ | |" aria-label="Verified: Not yet">');
  });

  test("a tick box is checked for a done row alone, the second box for a Not verified row alone (AC-3)", () => {
    const done = checkControls({ line: LINE, done: true }, "en");
    expect(done).toMatch(/name="tick"[^>]* checked /);
    expect(done).not.toMatch(/name="unverified"[^>]* checked /);
    const nv = checkControls({ line: LINE, done: true, notVerified: true }, "en");
    expect(nv).toMatch(/name="unverified"[^>]* checked /);
    expect(nv).not.toMatch(/name="tick"[^>]* checked /);
  });

  test("the form attribute goes on every box when the list sits outside its form (AC-3)", () => {
    expect(checkControls(row, "en", { formId: "f1" }).match(/form="f1"/g)).toHaveLength(3);
  });
});

describe("the boxes of an archived waiting row", () => {
  const html = checkControls({ line: LINE, done: true, notVerified: true }, "en", { archivedIndex: 2 });

  test("a tick box and a Failed box, named Yes and Failed; the note field alone in .failcontrol (AC-4)", () => {
    expect(html).toContain('name="tick"');
    expect(html).toContain('<label class="checkbox unverified"><input type="checkbox" name="failed"');
    expect(html).toContain('aria-label="Verified: Failed">');
    expect(html).not.toContain('name="unverified"');
    const block = /<div class="failcontrol">(.*?)<\/div>/s.exec(html)?.[1] ?? "";
    expect(block).toMatch(/^<textarea class="failnote" name="failnote-2"[^>]* rows="5" maxlength="500"/);
    expect(block).not.toContain("<input");
    expect(html.indexOf("failcontrol")).toBeGreaterThan(html.indexOf('name="failed"'));
  });
});

describe("the heading over the boxes", () => {
  test("Verified on the first line, Yes and Not yet on the second, hidden from a reader (AC-2)", () => {
    const html = checkColumns("en", false);
    expect(html).toMatch(/^<li class="checkcolumns" aria-hidden="true">/);
    expect(html).toContain('<div class="checkverified">Verified</div>');
    expect(html).toContain('<div class="checkyes">Yes</div>');
    expect(html).toContain('<div class="checkother">Not yet</div>');
  });

  test("an archived list names the second column Failed, and Not yet is nowhere (AC-4)", () => {
    const html = checkColumns("en", true);
    expect(html).toContain('<div class="checkother">Failed</div>');
    expect(html).not.toContain("Not yet");
  });

  test("the words and a box's name follow the page's language (AC-6)", () => {
    const html = checkColumns("nb", false);
    expect(html).toContain(">Verifisert<");
    expect(html).toContain(">Ja<");
    expect(html).toContain(">Ikke ennå<");
    expect(checkColumns("nb", true)).toContain(">Feilet<");
    expect(checkControls(row, "nb")).toContain('aria-label="Verifisert: Ja"');
  });
});

describe("a read-only mark", () => {
  test("keeps its words: ✅ or ☐, Not verified, Failed (AC-1)", () => {
    expect(checkReadOnlyMark({ line: LINE, done: true }, "en")).toContain("✅");
    expect(checkReadOnlyMark({ line: LINE, done: true, notVerified: true }, "en")).toContain("Not verified");
    expect(checkReadOnlyMark({ line: LINE, done: false, failed: true }, "en")).toContain("Failed");
  });
});
