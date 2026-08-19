// Criterion 1: discovery from an injectable scan root; specs-root
// resolution via .aide/config AIDE_SPECS_PATH vs the specs/ default;
// a manifest whose specs root does not exist yields zero specs, no
// error.
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildProjectViews, configValue, discoverProjects, specDependsOn, specDescription,
} from "../src/discover.ts";

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

// Spec 115: the walk from a projects root to what a page shows —
// discovery, then each project's manifest, then each spec's status —
// used to be inline in `main.ts`, where only the generator could reach
// it. The served `/projects` page needs the identical data from the
// identical files, so it moved here rather than being written a second
// time. What is asserted below is what the inline version produced for
// this same fixture, recorded before it was deleted.
describe("buildProjectViews", () => {
  test("every discovered project, with its manifest parsed", () => {
    const views = buildProjectViews(root);
    expect(views.map((p) => p.name)).toEqual(["proj-a", "proj-b", "proj-c"]);
    const a = views.find((p) => p.name === "proj-a")!;
    expect(a.manifest.ok).toBe(true);
    expect(a.manifest.ok && a.manifest.data.name).toBe("proj-a");
  });

  test("every spec, with its status where there is one and null where there is not", () => {
    const a = buildProjectViews(root).find((p) => p.name === "proj-a")!;
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
    expect(buildProjectViews(join(root, "nowhere-at-all"))).toEqual([]);
  });
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

// Spec 110: the `Depends on:` line (spec 92) has had a reader on the
// shell side since the day it existed. The page reads it too now — the
// row says what the spec builds on, in the same words the run's own
// refusal uses.
describe("specDependsOn", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aide-deps-"));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function spec(name: string, body: string): string {
    const d = join(dir, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "1-description.md"), body);
    return d;
  }

  const TRACKING = (line: string) =>
    `# X - Description\n\n## Tracking info\n\n- **Task:** \`09-x/\`\n- **Created:** \`2026-08-19\`\n` +
    `${line}\n\n---\n\n## Description\n\nprose\n`;

  test("every identifier on the line, in the order written, backticks stripped", () => {
    const d = spec("01-two", TRACKING("- **Depends on:** `105`, `92-a-spec-can-depend`"));
    expect(specDependsOn(d)).toEqual(["105", "92-a-spec-can-depend"]);
  });

  test("a single dependency is a one-item list", () => {
    expect(specDependsOn(spec("02-one", TRACKING("- **Depends on:** `105`")))).toEqual(["105"]);
  });

  test("no line, an empty one, or no file at all is an empty list — never a throw", () => {
    expect(specDependsOn(spec("03-none", TRACKING("")))).toEqual([]);
    expect(specDependsOn(spec("04-empty", TRACKING("- **Depends on:**")))).toEqual([]);
    expect(specDependsOn(join(dir, "nowhere"))).toEqual([]);
  });

  test("discoverProjects carries it alongside the title and the description", () => {
    const a = discoverProjects(root).find((p) => p.name === "proj-a")!;
    expect(a.specs.find((s) => s.folder === "01-first-thing")!.dependsOn).toEqual([]);
  });
});

// Spec 96: `AIDE_SPECS_PATH` stopped being the only key this file reads
// — the dashboard also asks a project what installing it means here.
// The reader was generalised for that, and generalising a parser is
// exactly where it quietly starts accepting more than it used to.
describe("one key out of a project's own .aide/config", () => {
  let dir: string;

  const write = (body: string): string => {
    const proj = mkdtempSync(join(tmpdir(), "aide-cfg-"));
    mkdirSync(join(proj, ".aide"), { recursive: true });
    writeFileSync(join(proj, ".aide", "config"), body);
    return proj;
  };

  test("the named key, and no other", () => {
    dir = write("AIDE_TEST_CMD=pytest -q\nAIDE_INSTALL_CMD=./install.sh\n");
    expect(configValue(dir, "AIDE_INSTALL_CMD")).toBe("./install.sh");
    expect(configValue(dir, "AIDE_TEST_CMD")).toBe("pytest -q");
    expect(configValue(dir, "AIDE_LINT_CMD")).toBeNull();
  });

  // A path or a command may perfectly well contain `=`.
  test("a value keeps every = after the first", () => {
    dir = write("AIDE_INSTALL_CMD=make install FLAGS=-q\n");
    expect(configValue(dir, "AIDE_INSTALL_CMD")).toBe("make install FLAGS=-q");
  });

  test("a comment, an indented line and an empty value are all no answer", () => {
    dir = write("# AIDE_INSTALL_CMD=commented\n  AIDE_INSTALL_CMD=indented\nAIDE_LINT_CMD=   \n");
    expect(configValue(dir, "AIDE_INSTALL_CMD")).toBeNull();
    expect(configValue(dir, "AIDE_LINT_CMD")).toBeNull();
  });

  test("no config file at all is no answer, never a throw", () => {
    expect(configValue(mkdtempSync(join(tmpdir(), "aide-cfg-")), "AIDE_INSTALL_CMD")).toBeNull();
  });
});
