// Split out of projects-page.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { AT, page, project } from "./projects-page-fixtures.ts";

describe("the listing on /projects", () => {
  // The same rows the generated overview drew, from the same function:
  // "same components" by construction, not by convention.
  test("one linked row per project, with its counts and description", () => {
    const html = page([
      project("alpha", {
        manifest: { ok: true, data: { name: "alpha", description: "the first one" } },
        specs: [
          { folder: "01-a", dir: "/x/01-a", archived: false, closed: false, title: "A", description: null, dependsOn: [], status: null },
          { folder: "02-b", dir: "/x/archive/02-b", archived: true, closed: false, title: "B", description: null, dependsOn: [], status: null },
        ],
      }),
      project("beta"),
    ]);
    // The word "Projects" is said once, in the tab (2026-08-21): the
    // shell's <h1> is hidden and the <h2> over the list is gone. What
    // opens the list now is the counts, beside the Add button.
    expect(html).not.toContain("<h2>Projects</h2>");
    expect(html).toContain('class="summary"');
    expect(html).toContain('class="proj-row"');
    // The served page links the page it serves. The generated site
    // still links its own files — `projectListBody` without `pageHref`.
    expect(html).toContain('href="/projects/alpha"');
    expect(html).toContain('href="/projects/beta"');
    expect(html).toContain("the first one");
    expect(html).toContain("1 active · 1 archived");
    expect(html).toContain("2 projects · 1 active · 1 archived");
  });

  test("a manifest that failed to parse is an error row, not a missing one", () => {
    const html = page([{ name: "brokenproj", manifest: { ok: false, error: "YAML parse error at line 3" }, specs: [] }]);
    expect(html).toContain("YAML parse error at line 3");
    expect(html).toMatch(/class="[^"]*error[^"]*"/);
  });

  // The link 112 left behind pointed at `/` because the management was
  // there. It is here now, so the link has nothing to point at.
  test("no Manage projects link — the management IS this page", () => {
    expect(page([project("alpha")])).not.toContain("Manage projects");
  });

  test("it carries the nav — and no stamp: the build time lives on About now", () => {
    const html = page([project("alpha")]);
    expect(html).toContain("<nav");
    expect(html).not.toContain(AT);
    expect(html).not.toContain("<h1>Projects</h1>");
  });

  test("no next-scheduled-run text on a row (AC-1)", () => {
    expect(page([project("aide")]).toLowerCase()).not.toContain("next scheduled run");
  });
});
