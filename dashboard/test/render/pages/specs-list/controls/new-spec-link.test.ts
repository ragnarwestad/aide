// The Specs list's button at the right-hand end of its search row: a link to
// the New spec page, named as that page is in the reader's language, and not
// drawn when no project may have a spec made in it.

import { describe, expect, test } from "bun:test";
import { t } from "../../../../../src/i18n";
import { newSpecLink } from "../../../../../src/render/pages/specs-list/filter-bar.ts";

describe("New spec on the Specs list", () => {
  test("a project may have a spec made in it: a link to /new, named as the page it leads to in the reader's language (AC-7)", () => {
    const html = newSpecLink({ createProjects: ["aide"] }, "nb");
    expect(html).toContain('href="/new"');
    expect(html).toContain(`>${t("nb", "newSpec.pageTitle")}<`);
  });

  test("no project may have a spec made in it: no link (AC-7)", () => {
    expect(newSpecLink({ createProjects: [] }, "nb")).toBe("");
  });
});
