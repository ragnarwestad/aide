// One right edge on the spec page: the banner, the tab row with its
// buttons, the panel head and the editor all stop at the same place.
// `.doc`'s own default is 60rem, but a field caps itself at 48rem to
// stay readable — so at the default the tab row's buttons sat 12rem to
// the right of everything they act on.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderJobDetailPage } from "../../src/render.ts";
import { NAV, detail } from "../render/pages/fixtures.ts";
import { page, view } from "../render/pages/spec-page-fixtures.ts";

const css = (name: string) => readFileSync(new URL(`../../src/render/ui/css/${name}`, import.meta.url), "utf8");

describe("the spec page takes the fields' right edge", () => {
  test("the document wrapper is marked as a page of fields", () => {
    expect(page(view())).toContain('<div class="doc formdoc">');
  });

  // The two numbers, read from the two files that hold them: the
  // wrapper's own cap has to be the fields' cap, or the page has two
  // right edges again.
  test("formdoc's cap is the same number .field.wide caps itself at", () => {
    const fieldCap = /\.field\.wide \{[^}]*max-width: (\d+rem)/.exec(css("field.css"))?.[1];
    const docCap = /\.doc\.formdoc[^{]*\{[^}]*max-width: (\d+rem)/.exec(css("text-roles.css"))?.[1];
    expect(fieldCap).toBeDefined();
    expect(docCap).toBe(fieldCap!);
  });

  // A page of TABLES keeps the wider default — narrowing those would
  // squeeze the columns, which is why this is a class and not a change
  // to `.doc` itself.
  test("the job page keeps the wider default", () => {
    const html = renderJobDetailPage(detail(), "2026-08-16T10:05:00Z", NAV, {});
    // The wrapper itself, not the stylesheet: every page inlines the
    // whole of it, `.doc.formdoc` rule included.
    expect(html).toContain('<div class="doc">');
    expect(html).not.toContain('class="doc formdoc"');
  });

  // The action group is one row or it is nothing: left free to shrink,
  // it stacks its buttons on top of each other instead of moving to the
  // next line whole.
  test("the tab row's action group can neither shrink nor wrap inside itself", () => {
    const rule = /nav\.tabbar\.subtabs > \.row \{([^}]*)\}/.exec(css("page.css"))?.[1] ?? "";
    expect(rule).toContain("flex: 0 0 auto");
    expect(rule).toContain("flex-wrap: nowrap");
  });
});
