// Split out of discover.test.ts by theme.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProjectViews, discoverProjects } from "../../src/project/discover.ts";
import { useDiscoverRoot } from "./discover-fixtures.ts";

const fx = useDiscoverRoot();

// Spec 115: the walk from a projects root to what a page shows —
// discovery, then each project's manifest, then each spec's status —
// used to be inline in `main.ts`, where only the generator could reach
// it. The served `/projects` page needs the identical data from the
// identical files, so it moved here rather than being written a second
// time. What is asserted below is what the inline version produced for
// this same fixture, recorded before it was deleted.
describe("buildProjectViews", () => {
  test("every discovered project, with its manifest parsed", () => {
    const views = buildProjectViews(fx.root);
    expect(views.map((p) => p.name)).toEqual(["proj-a", "proj-b", "proj-c"]);
    const a = views.find((p) => p.name === "proj-a")!;
    expect(a.manifest.ok).toBe(true);
    expect(a.manifest.ok && a.manifest.data.name).toBe("proj-a");
  });

  test("every spec, with its status where there is one and null where there is not", () => {
    const a = buildProjectViews(fx.root).find((p) => p.name === "proj-a")!;
    expect(a.specs.map((s) => [s.folder, s.archived])).toEqual([
      ["01-first-thing", false],
      ["02-old-thing", true],
    ]);
    expect(a.specs[0]!.status?.progress).toEqual({ percent: 50, done: 1, total: 2 });
    // No 4-status.md at all: null, never a throw and never an invented
    // zero — the page tells "not started" and "no file" apart.
    expect(a.specs[1]!.status).toBeNull();
  });

  test("a projects root that is not there is no projects, not a throw", () => {
    expect(buildProjectViews(join(fx.root, "nowhere-at-all"))).toEqual([]);
  });
});

describe("discoverProjects", () => {
  test("finds exactly the manifested projects", () => {
    const names = discoverProjects(fx.root).map((p) => p.name).sort();
    expect(names).toEqual(["proj-a", "proj-b", "proj-c"]);
  });

  test("resolves the specs root from .aide/config AIDE_SPECS_PATH", () => {
    const a = discoverProjects(fx.root).find((p) => p.name === "proj-a")!;
    expect(a.specsRoot).toBe(fx.externalSpecs);
  });

  test("falls back to specs/ in the project root without config", () => {
    const b = discoverProjects(fx.root).find((p) => p.name === "proj-b")!;
    expect(b.specsRoot).toBe(join(fx.root, "proj-b", "specs"));
    expect(b.specs.map((s) => s.folder)).toEqual(["03-b-thing"]);
  });

  test("walks active and archive/, flags archived, reads titles", () => {
    const a = discoverProjects(fx.root).find((p) => p.name === "proj-a")!;
    const byFolder = Object.fromEntries(a.specs.map((s) => [s.folder, s]));
    expect(byFolder["01-first-thing"].archived).toBe(false);
    expect(byFolder["01-first-thing"].title).toBe("The first thing");
    expect(byFolder["02-old-thing"].archived).toBe(true);
    expect(byFolder["02-old-thing"].title).toBe("The old thing");
  });

  test("a nonexistent specs root yields zero specs, no error", () => {
    const c = discoverProjects(fx.root).find((p) => p.name === "proj-c")!;
    expect(c.specs).toEqual([]);
  });
});

// Spec 218: WHICH spec folders exist is the dashboard's own checkout's
// answer, not the person's. A run resolves `--spec` against the clone
// the dashboard owns (spec 205), so a folder committed in the person's
// checkout and never pushed was listed on a page and refused by every
// step offered on its row.
//
// `specsRoot` on the result stays the person's own throughout: the
// write path's translation and the `fs.watch` that redraws a page still
// read it, and only which directory the FOLDERS are enumerated from
// moves.
describe("listing specs from a root the caller owns (spec 218)", () => {
  let ownedRoot: string;
  let owned: string;
  const forProjB = (project: string): string | undefined => (project === "proj-b" ? owned : undefined);

  beforeAll(() => {
    ownedRoot = mkdtempSync(join(tmpdir(), "aide-dash-owned-"));
    owned = join(ownedRoot, "proj-b", "specs");
    mkdirSync(join(owned, "04-pushed-thing"), { recursive: true });
    writeFileSync(join(owned, "04-pushed-thing", "1-description.md"), "# The pushed thing - Description\n");
    writeFileSync(
      join(owned, "04-pushed-thing", "4-status.md"),
      "# The pushed thing - Status\n\n**Total progress:** `25% (1 of 4 completed)`\n",
    );
    mkdirSync(join(owned, "archive", "05-pushed-and-archived"), { recursive: true });
    writeFileSync(
      join(owned, "archive", "05-pushed-and-archived", "1-description.md"),
      "# The pushed and archived thing - Description\n",
    );
  });

  afterAll(() => {
    rmSync(ownedRoot, { recursive: true, force: true });
  });

  test("the folders come from the resolver's root, and the person's own are not listed", () => {
    const b = discoverProjects(fx.root, forProjB).find((p) => p.name === "proj-b")!;
    expect(b.specs.map((s) => s.folder)).toEqual(["04-pushed-thing", "05-pushed-and-archived"]);
    expect(b.specs.map((s) => s.folder)).not.toContain("03-b-thing");
  });

  test("archive/ is walked under the resolver's root too, and flagged there", () => {
    const b = discoverProjects(fx.root, forProjB).find((p) => p.name === "proj-b")!;
    const byFolder = Object.fromEntries(b.specs.map((s) => [s.folder, s]));
    expect(byFolder["04-pushed-thing"].archived).toBe(false);
    expect(byFolder["05-pushed-and-archived"].archived).toBe(true);
    expect(byFolder["04-pushed-thing"].title).toBe("The pushed thing");
  });

  test("specsRoot stays the person's own, while each spec's dir is the owned one", () => {
    const b = discoverProjects(fx.root, forProjB).find((p) => p.name === "proj-b")!;
    expect(b.specsRoot).toBe(join(fx.root, "proj-b", "specs"));
    expect(b.dir).toBe(join(fx.root, "proj-b"));
    expect(b.specs[0]!.dir).toBe(join(owned, "04-pushed-thing"));
  });

  test("a project the resolver has no answer for is listed from its own checkout", () => {
    const a = discoverProjects(fx.root, forProjB).find((p) => p.name === "proj-a")!;
    expect(a.specs.map((s) => s.folder)).toEqual(["01-first-thing", "02-old-thing"]);
  });

  test("no resolver at all is every project's own checkout, exactly as before", () => {
    const b = discoverProjects(fx.root).find((p) => p.name === "proj-b")!;
    expect(b.specs.map((s) => s.folder)).toEqual(["03-b-thing"]);
  });

  test("buildProjectViews passes the resolver through, status file and all", () => {
    const b = buildProjectViews(fx.root, forProjB).find((p) => p.name === "proj-b")!;
    expect(b.specs.map((s) => s.folder)).toEqual(["04-pushed-thing", "05-pushed-and-archived"]);
    expect(b.specs[0]!.status?.progress).toEqual({ percent: 25, done: 1, total: 4 });
    // The status of a spec only the person has is not read at all — the
    // folder it is in was never listed.
    expect(b.specs.map((s) => s.folder)).not.toContain("03-b-thing");
  });
});
