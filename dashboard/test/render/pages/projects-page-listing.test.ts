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

  test("it carries the nav, and no stamp: the build time lives on About now", () => {
    const html = page([project("alpha")]);
    expect(html).toContain("<nav");
    expect(html).not.toContain(AT);
  });

  // Spec 482: Add/Remove/active/archived/the bare word "projects" in the
  // count line, and the manifest error sentence, were English string
  // literals, never routed through `t()`.
  test("Add, the counts and the manifest error read Norwegian, not English", () => {
    const html = page(
      [
        project("alpha", {
          manifest: { ok: true, data: { name: "alpha" } },
          specs: [
            { folder: "01-a", dir: "/x/01-a", archived: false, closed: false, title: "A", description: null, dependsOn: [], status: null },
            { folder: "02-b", dir: "/x/archive/02-b", archived: true, closed: false, title: "B", description: null, dependsOn: [], status: null },
          ],
        }),
        { name: "brokenproj", manifest: { ok: false, error: "YAML parse error at line 3" }, specs: [] },
      ],
      { lang: "nb", createProjects: ["alpha"] },
    );
    expect(html).toContain(">Legg til<");
    expect(html).toContain("2 prosjekter · 1 aktive · 1 arkiverte");
    expect(html).toContain("Manifest kunne ikke tolkes: YAML parse error at line 3");
    expect(html).toContain(">Fjern<");
    expect(html).not.toContain(">Add<");
    expect(html).not.toContain("projects ·");
    expect(html).not.toContain("Manifest failed to parse");
    expect(html).not.toContain(">Remove<");
  });

  // Spec 484, AC-5: the same English-leak guard, for the three languages
  // added beside English and Norwegian.
  test.each(["es", "de", "fr"] as const)("Add and Remove are not the English words in %s", (lang) => {
    const html = page(
      [project("alpha", { manifest: { ok: true, data: { name: "alpha" } }, specs: [] })],
      { lang, createProjects: ["alpha"] },
    );
    expect(html).not.toContain(">Add<");
    expect(html).not.toContain(">Remove<");
  });
});
