// The wiki as the specs repository's default branch holds it: what is read,
// in which order, and that the working tree is never what is shown.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { createGitRunner } from "../../../src/git/branch-status.ts";
import { refreshedRef } from "../../../src/git/branch-file.ts";
import { buildWikiGraph } from "../../../src/wiki-graph/links.ts";
import { readWiki } from "../../../src/project/wiki/read.ts";
import { cleanup, commitAll, generatedPage, git, initRepo, scratch, write } from "./wiki-fixtures.ts";

const dirs: string[] = [];
afterEach(() => cleanup(dirs));
const run = createGitRunner();

const INDEX = [
  "---", "wiki: generated", "commit: abc1234", "files: []", "---", "",
  "# Wiki index", "", "One line per page of the wiki.", "",
  "- [Charlie](charlie.md) — Third by name, first in the index.",
  "- [Alpha](alpha.md) — Alpha's summary.",
  "- [Gone](gone.md) — A page that is not on the branch.",
  "- [Bravo](bravo.md) — Bravo's summary.",
  "",
].join("\n");

/** A specs repository with a wiki, an origin it was cloned from, and a
 *  project checkout to judge states against. `top` is the specs clone. */
function fixture(withWiki = true) {
  const root = scratch(dirs);
  const project = join(root, "project");
  initRepo(project);
  write(project, "a.ts", "one\n");
  const commit = commitAll(project, "first");
  const seed = join(root, "seed");
  initRepo(seed);
  write(seed, "specs/keep.md", "keep\n");
  if (withWiki) {
    write(seed, "specs/wiki/index.md", INDEX);
    write(seed, "specs/wiki/charlie.md", generatedPage(commit, ["a.ts"], "Charlie", "Charlie text.") + "\nSee [Alpha](alpha.md).\n");
    write(seed, "specs/wiki/alpha.md", generatedPage(commit, ["a.ts"], "Alpha", "Alpha text."));
    write(seed, "specs/wiki/bravo.md", "# Bravo by hand\n\nBravo text.\n");
    write(seed, "specs/wiki/delta.md", "# Delta\n\nNot in the index.\n");
    write(seed, "specs/wiki/Notes.md", "# Not a page name\n\nNever listed.\n");
  }
  commitAll(seed, "first");
  const origin = join(root, "origin.git");
  Bun.spawnSync({ cmd: ["git", "clone", "-q", "--bare", seed, origin] });
  const top = join(root, "top");
  Bun.spawnSync({ cmd: ["git", "clone", "-q", origin, top] });
  git(top, "config", "user.name", "Test");
  git(top, "config", "user.email", "test@example.com");
  return { root, project, origin, top, dir: join(top, "specs") };
}

async function view(f: ReturnType<typeof fixture>, requested: string | null = null, dir = f.dir) {
  const { ref } = await refreshedRef(run, f.top, "main");
  return readWiki(run, { project: "aide", top: f.top, dir, ref: ref!, projectDir: f.project }, requested);
}

describe("the list (AC-1)", () => {
  test("follows the index's order, with its summaries, and leaves out a line whose page is gone (AC-1)", async () => {
    const v = await view(fixture());
    expect(v!.pages.slice(0, 3).map((p) => [p.page, p.title, p.summary])).toEqual([
      ["charlie.md", "Charlie", "Third by name, first in the index."],
      ["alpha.md", "Alpha", "Alpha's summary."],
      ["bravo.md", "Bravo", "Bravo's summary."],
    ]);
  });

  test("a page the index does not list follows, with its own title and summary; a name that is no page is not listed (AC-1)", async () => {
    const v = await view(fixture());
    expect(v!.pages.map((p) => p.page)).toEqual(["charlie.md", "alpha.md", "bravo.md", "delta.md"]);
    expect(v!.pages[3]).toMatchObject({ title: "Delta", summary: "Not in the index." });
  });

  test("each page carries its state (AC-1)", async () => {
    const v = await view(fixture());
    expect(Object.fromEntries(v!.pages.map((p) => [p.page, p.state]))).toEqual({
      "charlie.md": "current", "alpha.md": "current", "bravo.md": "hand-written", "delta.md": "hand-written",
    });
  });

  test("each page carries its own body, front matter cut off, for the graph above the list to read links out of", async () => {
    const v = await view(fixture());
    const charlie = v!.pages.find((p) => p.page === "charlie.md")!;
    expect(charlie.body).toContain("[Alpha](alpha.md)");
    expect(charlie.body).not.toContain("wiki: generated");
  });
});

describe("an open page (AC-2, AC-3, AC-5)", () => {
  test("is its text with the front matter cut off and its links rewritten (AC-2)", async () => {
    const v = await view(fixture(), "charlie.md");
    expect(v!.open).toMatchObject({ page: "charlie.md", state: "current" });
    const text = (v!.open as { text: string }).text;
    expect(text.startsWith("# Charlie")).toBe(true);
    expect(text).not.toContain("wiki: generated");
    expect(text).toContain("[Alpha](/projects/aide?tab=wiki&page=alpha.md)");
  });

  test("a name that is not on the branch is missing (AC-2)", async () => {
    const v = await view(fixture(), "nosuch.md");
    expect(v!.open).toEqual({ page: "nosuch.md", missing: true });
  });

  test("a name that is not a page name is not asked for at all (AC-5)", async () => {
    const v = await view(fixture(), "../x.md");
    expect(v!.open).toBeUndefined();
  });
});

describe("the default branch, never the working tree (AC-6)", () => {
  test("an edited working tree is not shown, and a moved origin is, once the fetch behind the read is done (AC-6)", async () => {
    const f = fixture();
    write(f.top, "specs/wiki/alpha.md", "# Alpha\n\nWORKING TREE\n");
    const first = await refreshedRef(run, f.top, "main");
    const before = await readWiki(run, { project: "aide", top: f.top, dir: f.dir, ref: first.ref!, projectDir: f.project }, "alpha.md");
    expect((before!.open as { text: string }).text).toContain("Alpha text.");
    expect((before!.open as { text: string }).text).not.toContain("WORKING TREE");

    const other = join(f.root, "other");
    Bun.spawnSync({ cmd: ["git", "clone", "-q", f.origin, other] });
    git(other, "config", "user.name", "Else");
    git(other, "config", "user.email", "else@example.com");
    write(other, "specs/wiki/alpha.md", generatedPage("abc1234", [], "Alpha", "MOVED ON ORIGIN"));
    commitAll(other, "move");
    git(other, "push", "-q", "origin", "main");

    // An open that starts after the push starts a fetch behind its own read;
    // the open after that one, once the fetch has finished, sees the move.
    await first.refreshed;
    await (await refreshedRef(run, f.top, "main")).refreshed;
    const second = await refreshedRef(run, f.top, "main");
    const after = await readWiki(run, { project: "aide", top: f.top, dir: f.dir, ref: second.ref!, projectDir: f.project }, "alpha.md");
    expect((after!.open as { text: string }).text).toContain("MOVED ON ORIGIN");
  });

  test("the wiki is found through a symlinked specs root (AC-6)", async () => {
    const f = fixture();
    const link = join(f.root, "link");
    symlinkSync(f.dir, link);
    const v = await view(f, null, link);
    expect(v!.pages.length).toBeGreaterThan(0);
  });
});

describe("no wiki (AC-8)", () => {
  test("a default branch with no index has none (AC-8)", async () => {
    expect(await view(fixture(false))).toBeNull();
  });

  test("a folder that is not in the repository has none (AC-8)", async () => {
    const f = fixture();
    mkdirSync(join(f.root, "elsewhere"), { recursive: true });
    expect(await view(f, null, join(f.top, "nothere"))).toBeNull();
  });
});


test("legacy indexed and fallback pages stay out of graph input while direct reads work (AC-6)", async () => {
  const f = fixture();
  const legacy = "---\nwiki: decision\nspec: old\n---\n\n# Legacy\n\nOld reason.\n";
  write(f.top, "specs/wiki/legacy.md", legacy);
  write(f.top, "specs/wiki/unlisted.md", legacy);
  write(f.top, "specs/wiki/index.md", INDEX + "- [Legacy](legacy.md) — Old.\n");
  write(f.top, "specs/wiki/delta.md", "# Delta\n\nwiki: decision\n[Alpha](alpha.md) [Old](legacy.md)\n");
  commitAll(f.top, "legacy fixtures");
  git(f.top, "push", "-q", "origin", "main");
  await (await refreshedRef(run, f.top, "main")).refreshed;
  const v = await view(f, "legacy.md");
  expect(v!.pages.map((p) => p.page)).toEqual(["charlie.md", "alpha.md", "bravo.md", "delta.md"]);
  expect(v!.open).toMatchObject({ page: "legacy.md", text: "# Legacy\n\nOld reason.\n" });
  const graph = buildWikiGraph(v!.pages);
  expect(graph.points.length).toBe(4);
  expect(graph.pairs.length).toBe(2);
});
