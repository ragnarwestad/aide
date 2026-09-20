// Split out of spec-page.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { type SpecPageView } from "../../../src/render";
import { page, view } from "./spec-page-fixtures.ts";

// --- spec 198: reopening a spec is one action -------------------------------
//
// An archived spec whose work has to be done again was reopened by hand
// in a terminal — move the folder, overwrite three files, hunt down the
// branch in two repositories and two places each. Done twice, missed
// something both times. The control belongs where the spec is.
//
// Everything ELSE about an archived spec stays as spec 163 left it: no
// textarea on the Description tab, the same read-only note, and checks
// that are shown but cannot be ticked.
describe("spec 198: the Reopen control", () => {
  const archived = (extra: Partial<SpecPageView> = {}) =>
    page(view({ archived: true, ...extra }));

  // Spec 511: Reopen asks its question on a page of its own, so the
  // control is a link to that page, and posts nothing itself.
  test("an archived spec offers exactly one action, and it is a link to the Reopen page AC-1", () => {
    const html = archived();
    expect(html).toContain('<a class="btn" href="/specs/aide/150-one-page-shows-the-whole-spec/reopen">Reopen</a>');
    expect(html).not.toContain('name="steps" value="reopen"');
  });

  test("it is a link, not a form: a reload cannot run it AC-1", () => {
    expect(archived()).not.toMatch(/<form[^>]*action="\/api\/queue"/);
  });

  // Reopen sat under the archived note while Update sat up on the head
  // line, so the page's two buttons were in two places (2026-08-23,
  // "Reopen og Update kan vel gjerne stå sammen?"). One group now, at
  // the end of the tab row (spec 300 moved it off its own line above
  // the tabs).
  test("Reopen and Update share one group at the end of the tab row", () => {
    const group = /<nav class="tabbar subtabs">[\s\S]*?<span class="row">([\s\S]*?)<\/span><\/nav>/.exec(archived())?.[1] ?? "";
    expect(group).toContain("Reopen");
    expect(group).toContain("Update");
    // Reopen FIRST: Update is on every spec page, and a button that
    // slid sideways whenever a spec was archived would be moving
    // because something else appeared.
    expect(group.indexOf("Reopen")).toBeLessThan(group.indexOf("Update"));
    // Moved, not copied: one Reopen on the page, and it is this one.
    expect(archived().match(/\/reopen">Reopen</g)).toHaveLength(1);
  });

  // Being archived is what is the case, not something that just
  // happened, so it is one plain sentence and never the notice shape.
  test("being archived is one self-contained sentence, not a notice", () => {
    const html = archived();
    expect(html).toContain(
      "This spec has been archived, and cannot be edited until the spec is reopened",
    );
    // Not the notice shape: that one is for what just happened.
    expect(html).not.toMatch(/class="rowmsg info"[^>]*>[\s\S]{0,80}archived/);
  });

  test("a live spec says nothing about being archived", () => {
    expect(page(view({}))).not.toContain("<strong>Archived</strong>");
  });

  // A live spec has the whole row on the queue list for this; the
  // archived page is the one place a reopen can be asked for.
  test("a live spec's page offers nothing of the sort", () => {
    expect(page(view({}))).not.toContain("Reopen");
  });

  test("the archived note is unchanged, and nothing on the page edits", () => {
    const html = archived();
    expect(html).not.toContain("/edit");
    expect(html).toContain("archived");
    expect(page(view({ archived: true }), "description")).not.toContain("<textarea");
  });
});

describe("spec 252: the spec page's own Back link", () => {
  test("← Back tracks the given backHref", () => {
    const html = page(view({ backHref: "/?state=all&q=archive" }));
    expect(html).toContain('<a class="backlink" href="/?state=all&amp;q=archive">← Back</a>');
  });

  test("← Back falls back to / when nothing was given", () => {
    const html = page();
    expect(html).toContain('<a class="backlink" href="/">← Back</a>');
  });
});
