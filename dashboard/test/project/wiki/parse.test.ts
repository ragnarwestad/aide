// The page format, in one place: the index's lines, the front matter, the
// name of a page and the rewrite that makes a link between pages open on the
// Wiki tab.

import { describe, expect, test } from "bun:test";
import {
  WIKI_PAGE, pageSummary, pageTitle, parseIndex, rewritePageLinks, splitPage, wikiPagePath,
} from "../../../src/project/wiki/parse.ts";

const GENERATED = [
  "---",
  "wiki: generated",
  "commit: 48c72638c6a5e34dd5a6c938ea5af988364c4728",
  "files:",
  "  - dashboard/src/a.ts",
  "  - core/scripts/b",
  "---",
  "",
  "# Landing",
  "",
  "How a branch lands.",
  "",
].join("\n");

describe("splitPage (AC-2)", () => {
  test("reads the mark, the commit and the files, and cuts the front matter off the body (AC-2)", () => {
    const { mark, body } = splitPage(GENERATED);
    expect(mark).toEqual({
      generated: true,
      commit: "48c72638c6a5e34dd5a6c938ea5af988364c4728",
      files: ["dashboard/src/a.ts", "core/scripts/b"],
    });
    expect(body.startsWith("# Landing")).toBe(true);
    expect(body).not.toContain("wiki: generated");
  });

  test("a page with no front matter is hand-written and is all body (AC-2)", () => {
    const { mark, body } = splitPage("# Notes\n\nBy hand.\n");
    expect(mark.generated).toBe(false);
    expect(body).toBe("# Notes\n\nBy hand.\n");
  });

  test("front matter without the mark is hand-written, and is still cut off (AC-2)", () => {
    const { mark, body } = splitPage("---\ntitle: x\n---\n\n# Notes\n");
    expect(mark.generated).toBe(false);
    expect(body.startsWith("# Notes")).toBe(true);
  });

  test("an empty files list names no files (AC-2)", () => {
    expect(splitPage("---\nwiki: generated\ncommit: abc1234\nfiles: []\n---\n\n# X\n").mark.files).toEqual([]);
  });
});

describe("the index (AC-1)", () => {
  const INDEX = [
    "# Wiki index",
    "",
    "One line per page of the wiki.",
    "",
    "- [Skills](skills.md) — The slash commands.",
    "- [Landing](landing.md) — How a branch lands, with a dash — inside.",
    "- [No summary](nosummary.md)",
    "- [Not a page](https://example.com/x.md) — external",
    "",
  ].join("\n");

  test("its lines come out in the index's own order, with their summaries (AC-1)", () => {
    expect(parseIndex(INDEX)).toEqual([
      { page: "skills.md", title: "Skills", summary: "The slash commands." },
      { page: "landing.md", title: "Landing", summary: "How a branch lands, with a dash — inside." },
      { page: "nosummary.md", title: "No summary", summary: "" },
    ]);
  });

  test("a page not in the index gets the title and summary the index would have given it (AC-1)", () => {
    const body = "# Notes by hand\n\nWhat this is.\n\nMore.\n";
    expect(pageTitle(body, "notes.md")).toBe("Notes by hand");
    expect(pageSummary(body)).toBe("What this is.");
    expect(pageTitle("no heading\n", "notes.md")).toBe("notes");
  });

  test("a page name is lower-case letters, digits and hyphens ending in .md (AC-1)", () => {
    for (const ok of ["landing.md", "spec-page.md", "a1.md"]) expect(WIKI_PAGE.test(ok)).toBe(true);
    for (const bad of ["Notes.md", "../x.md", "a/b.md", "x.txt", ".md", "a.md/b"]) expect(WIKI_PAGE.test(bad)).toBe(false);
  });
});

describe("a link between pages (AC-3)", () => {
  test("opens the page on the Wiki tab, keeping the fragment (AC-3)", () => {
    const text = "See [Landing](landing.md) and [the schema](schema.md#links).";
    expect(rewritePageLinks(text, "aide")).toBe(
      "See [Landing](/projects/aide?tab=wiki&page=landing.md) and [the schema](/projects/aide?tab=wiki&page=schema.md#links).",
    );
  });

  test("leaves other links alone: external, in-page anchors, other files (AC-3)", () => {
    const text = "[a](https://example.com/x.md) [b](#top) [c](../x.md) [d](Notes.md) `landing.md`";
    expect(rewritePageLinks(text, "aide")).toBe(text);
  });

  test("the project's name is encoded in the address (AC-3)", () => {
    expect(wikiPagePath("my project", "a.md")).toBe("/projects/my%20project?tab=wiki&page=a.md");
    expect(wikiPagePath("aide")).toBe("/projects/aide?tab=wiki");
  });
});


test("recognizes legacy pages only by complete front matter (AC-6)", () => {
  expect(splitPage("---\nwiki: decision\n---\n\n# Old\n").mark.legacyDecision).toBe(true);
  for (const text of ["# Notes\n\nwiki: decision\n", GENERATED + "\nwiki: decision\n", "---\nwiki: decision\n"]) {
    expect(splitPage(text).mark.legacyDecision).toBeUndefined();
  }
});
