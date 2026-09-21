// The Add-project page's fields, measured in a real browser: whether two
// fields sharing a row are halves of it, and whether every row ends at
// the same edge.
//
// A text-only render test cannot see any of this — the widths come from
// the stylesheet, and a field left out of a row changes what the others
// get. The form read as "hulter til bulter" on 2026-09-21: the two rows
// with a field each stopped at the 48rem a `.field.wide` is capped to,
// while the rows above them split the whole window between two fields
// and reached well past that, so no two edges lined up.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderAddProjectPage } from "../../src/render";

setDefaultTimeout(20_000);

let browser: Browser;
let page: Page;
let dir: string;

// The page itself, written to a file — no board and no server. What is
// under test is the stylesheet against the markup, both of which
// `pageShell` puts in the page, and this suite already runs eight
// browsers side by side: a ninth that also starts a server is what tips
// another file's own hooks past their timeout.
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aide-add-form-"));
  const html = renderAddProjectPage([{ label: "Projects", path: "/projects" }], new Date().toISOString(), {});
  writeFileSync(join(dir, "add-project.html"), html);
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(`file://${join(dir, "add-project.html")}`);
});

afterAll(async () => {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Every row of the form: where its CONTENT begins and ends — the row
 *  boxes themselves are always the form's full width, and what a reader
 *  sees is the edges of the boxes inside them.
 *
 *  The page is loaded ONCE, in `beforeAll`, and a width change is a
 *  resize rather than a second navigation: this file is one more browser
 *  in a suite that already runs eight of them side by side, and three
 *  loads of it pushed other files' own hooks past their timeout. */
async function rows(width: number): Promise<{ left: number; right: number; fields: number[] }[]> {
  await page.setViewportSize({ width, height: 1000 });
  return page.evaluate(() =>
    [...document.querySelectorAll("form.addprojectform > .frow")].map((row) => {
      const boxes = [...row.children].map((c) => c.getBoundingClientRect());
      return {
        left: Math.round(Math.min(...boxes.map((b) => b.left))),
        right: Math.round(Math.max(...boxes.map((b) => b.right))),
        fields: [...row.querySelectorAll(":scope > .field")].map((f) => Math.round(f.getBoundingClientRect().width)),
      };
    }),
  );
}

describe("the Add-project form's rows", () => {
  test("two fields on one row are halves of it", async () => {
    const found = await rows(1200);
    const pairs = found.filter((r) => r.fields.length === 2);

    expect(pairs.length).toBeGreaterThan(0);
    for (const row of pairs) {
      expect(Math.abs(row.fields[0]! - row.fields[1]!)).toBeLessThanOrEqual(1);
    }
  });

  test("every row's content starts and ends on the same edges, whatever it holds", async () => {
    const found = await rows(1200);

    expect(found.length).toBeGreaterThan(2);
    const lefts = new Set(found.map((r) => r.left));
    const rights = new Set(found.map((r) => r.right));
    expect([...lefts]).toHaveLength(1);
    expect([...rights]).toHaveLength(1);
  });

  test("a field's own box never reaches past its row", async () => {
    // At phone width the halves are narrow, and an input that kept a
    // minimum of its own would push the page sideways instead.
    const found = await rows(390);

    for (const row of found) {
      for (const field of row.fields) {
        expect(field).toBeLessThanOrEqual(row.right - row.left);
      }
    }
  });
});
