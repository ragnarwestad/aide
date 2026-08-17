// Criterion 1: discovery from an injectable scan root; specs-root
// resolution via .aide/config AIDE_SPECS_PATH vs the specs/ default;
// a manifest whose specs root does not exist yields zero specs, no
// error.
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverProjects, specDescription } from "../src/discover.ts";

let root: string;
let externalSpecs: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "aide-dash-"));
  externalSpecs = join(root, "external-specs", "proj-a");

  // proj-a: manifest + .aide/config pointing at an external specs root
  const a = join(root, "proj-a");
  mkdirSync(join(a, ".aide"), { recursive: true });
  writeFileSync(join(a, ".aide", "project.yaml"), "name: proj-a\n");
  writeFileSync(join(a, ".aide", "config"), `AIDE_SPECS_PATH=${externalSpecs}\n`);
  mkdirSync(join(externalSpecs, "01-first-thing"), { recursive: true });
  writeFileSync(
    join(externalSpecs, "01-first-thing", "1-description.md"),
    "# The first thing - Description\n\n## Description\n\nIt does the first thing, thoroughly.\n\n---\n",
  );
  writeFileSync(
    join(externalSpecs, "01-first-thing", "4-status.md"),
    "# The first thing - Status\n\n**Total progress:** `50% (1 of 2 completed)`\n",
  );
  mkdirSync(join(externalSpecs, "archive", "02-old-thing"), { recursive: true });
  writeFileSync(
    join(externalSpecs, "archive", "02-old-thing", "1-description.md"),
    "# The old thing - Description\n",
  );

  // proj-b: manifest, no config -> specs/ in the project root
  const b = join(root, "proj-b");
  mkdirSync(join(b, ".aide"), { recursive: true });
  writeFileSync(join(b, ".aide", "project.yaml"), "name: proj-b\n");
  mkdirSync(join(b, "specs", "03-b-thing"), { recursive: true });
  writeFileSync(
    join(b, "specs", "03-b-thing", "1-description.md"),
    "# The b thing - Description\n",
  );

  // proj-c: manifest, config pointing at a directory that does not exist
  const c = join(root, "proj-c");
  mkdirSync(join(c, ".aide"), { recursive: true });
  writeFileSync(join(c, ".aide", "project.yaml"), "name: proj-c\n");
  writeFileSync(join(c, ".aide", "config"), `AIDE_SPECS_PATH=${join(root, "nowhere")}\n`);

  // not a project: no manifest
  mkdirSync(join(root, "plain-dir"), { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("discoverProjects", () => {
  test("finds exactly the manifested projects", () => {
    const names = discoverProjects(root).map((p) => p.name).sort();
    expect(names).toEqual(["proj-a", "proj-b", "proj-c"]);
  });

  test("resolves the specs root from .aide/config AIDE_SPECS_PATH", () => {
    const a = discoverProjects(root).find((p) => p.name === "proj-a")!;
    expect(a.specsRoot).toBe(externalSpecs);
  });

  test("falls back to specs/ in the project root without config", () => {
    const b = discoverProjects(root).find((p) => p.name === "proj-b")!;
    expect(b.specsRoot).toBe(join(root, "proj-b", "specs"));
    expect(b.specs.map((s) => s.folder)).toEqual(["03-b-thing"]);
  });

  test("walks active and archive/, flags archived, reads titles", () => {
    const a = discoverProjects(root).find((p) => p.name === "proj-a")!;
    const byFolder = Object.fromEntries(a.specs.map((s) => [s.folder, s]));
    expect(byFolder["01-first-thing"].archived).toBe(false);
    expect(byFolder["01-first-thing"].title).toBe("The first thing");
    expect(byFolder["02-old-thing"].archived).toBe(true);
    expect(byFolder["02-old-thing"].title).toBe("The old thing");
  });

  test("a nonexistent specs root yields zero specs, no error", () => {
    const c = discoverProjects(root).find((p) => p.name === "proj-c")!;
    expect(c.specs).toEqual([]);
  });
});

// Criterion 1 (spec 02): what a job IS. The title alone says "83-multi-
// project-jobs"; the description says what that spec is about, and
// today a reader has to leave the dashboard to read it.
describe("specDescription", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aide-desc-"));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function spec(name: string, body: string): string {
    const d = join(dir, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "1-description.md"), body);
    return d;
  }

  test("returns the prose under ## Description, up to the next heading", () => {
    const d = spec(
      "01-plain",
      "# A thing - Description\n\n## Table of contents\n\n- [Description](#description)\n\n---\n\n" +
        "## Description\n\nThe queue shows a job's state.\n\nIt shows nothing about what the job IS.\n\n" +
        "---\n\n## Related documents\n\n- [2-analysis.md](./2-analysis.md)\n",
    );
    const got = specDescription(d)!;
    expect(got).toContain("The queue shows a job's state.");
    expect(got).toContain("It shows nothing about what the job IS.");
    expect(got).not.toContain("Related documents");
    expect(got).not.toContain("Table of contents");
  });

  test("the template's own editing note is not part of the description", () => {
    const d = spec(
      "02-note",
      "# X - Description\n\n## Description\n\nReal prose here.\n\n" +
        "_(This field can be edited manually to add extra context or clarifications " +
        "and will not be overwritten by aide commands)_\n\n---\n",
    );
    const got = specDescription(d)!;
    expect(got).toContain("Real prose here.");
    expect(got).not.toContain("edited manually");
  });

  test("a description section with nothing in it is null, not an empty string", () => {
    const d = spec("03-empty", "# X - Description\n\n## Description\n\n---\n\n## Related documents\n");
    expect(specDescription(d)).toBeNull();
  });

  test("no Description heading, or no file at all, is null rather than a throw", () => {
    expect(specDescription(spec("04-noheading", "# X - Description\n\nloose prose\n"))).toBeNull();
    expect(specDescription(join(dir, "nowhere"))).toBeNull();
  });

  test("discoverProjects carries the description alongside the title", () => {
    const a = discoverProjects(root).find((p) => p.name === "proj-a")!;
    const first = a.specs.find((s) => s.folder === "01-first-thing")!;
    expect(first.description).toBe("It does the first thing, thoroughly.");
  });
});
