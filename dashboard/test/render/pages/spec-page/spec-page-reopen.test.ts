// Split out of spec-page.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { type SpecPageView } from "../../../../src/render";
import { page, view } from "../spec-page-fixtures.ts";

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

  // A live spec has the whole row on the queue list for this; the
  // archived page is the one place a reopen can be asked for.
  test("a live spec's page offers nothing of the sort", () => {
    expect(page(view({}))).not.toContain("Reopen");
  });
});
