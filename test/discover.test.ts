// Criterion 1: discovery from an injectable scan root; specs-root
// resolution via .aide/config AIDE_SPECS_PATH vs the specs/ default;
// a manifest whose specs root does not exist yields zero specs, no
// error.
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverProjects } from "../src/discover.ts";

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
    "# The first thing - Description\n",
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
    expect(byFolder["01-first-thing"].title).toBe("The first thing - Description");
    expect(byFolder["02-old-thing"].archived).toBe(true);
    expect(byFolder["02-old-thing"].title).toBe("The old thing - Description");
  });

  test("a nonexistent specs root yields zero specs, no error", () => {
    const c = discoverProjects(root).find((p) => p.name === "proj-c")!;
    expect(c.specs).toEqual([]);
  });
});
