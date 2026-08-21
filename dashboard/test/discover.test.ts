// Criterion 1: discovery from an injectable scan root; specs-root
// resolution via .aide/config AIDE_SPECS_PATH vs the specs/ default;
// a manifest whose specs root does not exist yields zero specs, no
// error.
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SPEC_FILES, buildProjectViews, configValue, discoverProjects, discoverUnclaimedDirectories,
  gitignoreCandidates, markdownSection, specDependsOn, specDescription, specFileText,
  specArchivedDate, specPhaseFile, stripDependsOnLine, withDependsOnLine,
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

  // Spec 166: the same line gets a WRITER, so a dependency can be named
  // after the spec exists. Pure string surgery, in the module that
  // already owns the line's shape — the Edit page's Save is what calls
  // it, and the runtime gate reads the result unchanged.
  //
  // Its own fixture rather than `TRACKING`: that one leaves a blank
  // line where the dependency line would be, which is fine for a reader
  // asserting a parsed list but would make every exact-text assertion
  // here about the blank line instead of the write.
  const DESC = (line = "") =>
    `# X - Description\n\n## Tracking info\n\n- **Task:** \`09-x/\`\n- **Created:** \`2026-08-19\`\n` +
    (line ? `${line}\n` : "") +
    `\n---\n\n## Description\n\nprose\n`;

  describe("stripDependsOnLine", () => {
    test("takes the line out and leaves everything else where it was", () => {
      expect(stripDependsOnLine(DESC("- **Depends on:** `105`"))).toBe(DESC());
    });

    test("a text with no line at all comes back as it went in", () => {
      expect(stripDependsOnLine(DESC())).toBe(DESC());
    });

    // A textarea posts CRLF whatever the file had, and `asFileText`
    // normalises the same way — the two passes have to agree, or a
    // strip that missed the line would leave the write keeping it.
    test("CRLF is normalised to LF, and the line goes either way", () => {
      expect(stripDependsOnLine(DESC("- **Depends on:** `105`").replace(/\n/g, "\r\n"))).toBe(DESC());
    });
  });

  describe("withDependsOnLine", () => {
    test("inserts right after Created when there is no existing line", () => {
      expect(withDependsOnLine(DESC(), ["164"])).toBe(DESC("- **Depends on:** `164`"));
    });

    test("replaces an existing line rather than writing a second one", () => {
      const out = withDependsOnLine(DESC("- **Depends on:** `105`"), ["164", "92-a-spec"]);
      expect(out).toBe(DESC("- **Depends on:** `164`, `92-a-spec`"));
      expect(out!.match(/Depends on/g)).toHaveLength(1);
    });

    test("an empty list removes the line", () => {
      expect(withDependsOnLine(DESC("- **Depends on:** `105`"), [])).toBe(DESC());
    });

    // Nowhere to put it is a refusal for the caller to make, not a
    // guess about where Tracking info would have been.
    test("no Created line to anchor on is a null, not a guess", () => {
      expect(withDependsOnLine("# X\n\nprose\n", ["164"])).toBeNull();
    });

    test("but removing needs no anchor — an empty list is never a null", () => {
      expect(withDependsOnLine("# X\n\nprose\n", [])).toBe("# X\n\nprose\n");
    });

    test("what it writes is what specDependsOn reads back", () => {
      const d = spec("05-roundtrip", withDependsOnLine(DESC(), ["164", "165"])!);
      expect(specDependsOn(d)).toEqual(["164", "165"]);
    });
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

// Spec 131: the Add-project form used to ask the reader to TYPE the path
// of a checkout already on the host, when the only path the server would
// accept follows from the projects root and the name. The picker it
// became needs the inverse of `discoverProjects`: the directories under
// the same root that carry NO manifest yet.
describe("discoverUnclaimedDirectories", () => {
  let unclaimed: string;

  beforeAll(() => {
    unclaimed = mkdtempSync(join(tmpdir(), "aide-unclaimed-"));
    // A project: it has a manifest, so it is claimed already.
    mkdirSync(join(unclaimed, "aide", ".aide"), { recursive: true });
    writeFileSync(join(unclaimed, "aide", ".aide", "project.yaml"), "name: aide\n");
    // Two checkouts nobody has registered.
    mkdirSync(join(unclaimed, "atlasaurus"), { recursive: true });
    mkdirSync(join(unclaimed, "scratch"), { recursive: true });
    // Two names that could never BE a project name, so offering them
    // would only produce a refusal the reader cannot act on.
    mkdirSync(join(unclaimed, ".hidden-dir"), { recursive: true });
    mkdirSync(join(unclaimed, "has a space"), { recursive: true });
    // A file is not a directory, whatever it is called.
    writeFileSync(join(unclaimed, "loose-file"), "not a checkout\n");
  });

  afterAll(() => {
    rmSync(unclaimed, { recursive: true, force: true });
  });

  // Criterion 1.
  test("lists the manifest-less directories, sorted, and no project", () => {
    expect(discoverUnclaimedDirectories(unclaimed)).toEqual(["atlasaurus", "scratch"]);
  });

  // Criterion 2.
  test("a name that could never be a project name is not offered", () => {
    const found = discoverUnclaimedDirectories(unclaimed);
    expect(found).not.toContain(".hidden-dir");
    expect(found).not.toContain("has a space");
  });

  test("a root that is not there at all is an empty list, never a throw", () => {
    expect(discoverUnclaimedDirectories(join(unclaimed, "nowhere"))).toEqual([]);
  });
});

// Spec 140: nothing can DERIVE which gitignored paths a project's own
// test command needs — which is why the Add form asks — but the
// checkout's own `.gitignore` names the candidates, and the form read
// no such file. This is the reader of it: suggestions for a field, not
// an answer, so only the entries `AIDE_WORKTREE_LINKS` could actually
// take are offered.
describe("gitignoreCandidates", () => {
  let checkouts: string;

  const withIgnore = (name: string, text: string): string => {
    const dir = join(checkouts, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".gitignore"), text);
    return dir;
  };

  beforeAll(() => {
    checkouts = mkdtempSync(join(tmpdir(), "aide-gitignore-"));
  });

  afterAll(() => {
    rmSync(checkouts, { recursive: true, force: true });
  });

  // Criterion 5.
  test("plain top-level entries are offered, and nothing else is", () => {
    const dir = withIgnore(
      "mixed",
      "# note\nnode_modules\n.venv/\n*.log\n!keep.txt\nbuild/tmp\n\n",
    );
    expect(gitignoreCandidates(dir)).toEqual(["node_modules", ".venv"]);
  });

  test("a checkout with no .gitignore offers nothing, and does not throw", () => {
    const dir = join(checkouts, "bare");
    mkdirSync(dir, { recursive: true });
    expect(gitignoreCandidates(dir)).toEqual([]);
  });

  test("a directory that is not there at all is an empty list too", () => {
    expect(gitignoreCandidates(join(checkouts, "nowhere"))).toEqual([]);
  });
});

// --- spec 150: the whole spec, read off disk ---------------------------------
//
// `specTitle` and `specDescription` read one section of one file. The
// spec page shows all four files as they stand, so it needs the raw
// text — and a spec half-written (analysis started, solution still the
// template, status absent) has to render as what it is, not as a crash.

describe("the four spec files, raw", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aide-specfiles-"));
    mkdirSync(join(dir, "150-one-page"), { recursive: true });
    writeFileSync(join(dir, "150-one-page", "1-description.md"), "# One page - Description\n\nprose\n");
    writeFileSync(
      join(dir, "150-one-page", "3-solution.md"),
      "# One page - Solution\n\n## Recommended solution\n\nApproach 1.\n\n## Plan review\n\n" +
        "Reviewed by three reviewers.\n\n## Risk analysis\n\nMedium.\n",
    );
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("the order is the order they are written and read", () => {
    expect(SPEC_FILES).toEqual([
      "1-description.md",
      "2-analysis.md",
      "3-solution.md",
      "4-status.md",
    ]);
  });

  test("a file that is there comes back whole, not as an excerpt", () => {
    expect(specFileText(join(dir, "150-one-page"), "1-description.md")).toBe(
      "# One page - Description\n\nprose\n",
    );
  });

  test("a file that is not there is null, and not an empty string", () => {
    // The page tells "nothing written yet" from "written and empty".
    expect(specFileText(join(dir, "150-one-page"), "2-analysis.md")).toBeNull();
  });

  test("a directory in place of a file is null, not a throw", () => {
    mkdirSync(join(dir, "150-one-page", "4-status.md"), { recursive: true });
    expect(specFileText(join(dir, "150-one-page"), "4-status.md")).toBeNull();
  });

  test("a spec folder that does not exist reads as four missing files", () => {
    for (const name of SPEC_FILES) {
      expect(specFileText(join(dir, "no-such-spec"), name)).toBeNull();
    }
  });
});

// The review-plan phase's page shows ONE section of 3-solution.md, and
// the rule that finds it is the rule `specDescription` has always used:
// to the next heading or the next `---`, and no markdown parser.
describe("markdownSection", () => {
  const SOLUTION =
    "# S - Solution\n\n## Recommended solution\n\nApproach 1.\n\n## Plan review\n\n" +
    "Reviewed by three reviewers.\n\n## Risk analysis\n\nMedium.\n";

  test("a section runs to the next heading", () => {
    expect(markdownSection(SOLUTION, "Plan review")).toBe("Reviewed by three reviewers.");
  });

  test("a section runs to a horizontal rule too", () => {
    expect(markdownSection("## Plan review\n\nnothing yet.\n\n---\n\n## Risk\n", "Plan review")).toBe(
      "nothing yet.",
    );
  });

  test("the last section runs to the end of the file", () => {
    expect(markdownSection(SOLUTION, "Risk analysis")).toBe("Medium.");
  });

  test("a heading nobody wrote is null, never the whole file", () => {
    expect(markdownSection(SOLUTION, "Plan revue")).toBeNull();
  });

  test("a section with nothing under it is null, not an empty string", () => {
    expect(markdownSection("## Plan review\n\n## Risk\n\nMedium.\n", "Plan review")).toBeNull();
  });
});

// --- spec 150: what a phase MADE --------------------------------------------
//
// "A phase's page shows what that phase made": analyze wrote
// 2-analysis.md, review-plan wrote one section of 3-solution.md,
// implement wrote 4-status.md, and archive either moved the folder or
// said why it did not. Nothing else of the spec is repeated there.

describe("specPhaseFile", () => {
  let dir: string;
  const STATUS_HEAD = "# S - Status\n\n## Tracking info\n\n- **Task:** `x`\n";

  const write = (name: string, text: string) => writeFileSync(join(dir, name), text);

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aide-phase-"));
    write("1-description.md", "# S - Description\n\n## Description\n\nWhat it is about.\n");
    write("2-analysis.md", "# S - Analysis\n\n## Findings\n\nSeven files.\n");
    write(
      "3-solution.md",
      "# S - Solution\n\n## Recommended solution\n\nApproach 1.\n\n## Plan review\n\n" +
        "One must-fix, five should-fix.\n\n## Risk analysis\n\nMedium.\n",
    );
    write("4-status.md", `${STATUS_HEAD}\n## Phase 1: RED\n\nNothing yet.\n`);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("create shows the description it wrote", () => {
    expect(specPhaseFile(dir, "create")).toEqual({
      label: "1-description.md",
      text: "# S - Description\n\n## Description\n\nWhat it is about.\n",
    });
  });

  test("analyze shows 2-analysis.md (criterion 5)", () => {
    expect(specPhaseFile(dir, "analyze")?.label).toBe("2-analysis.md");
    expect(specPhaseFile(dir, "analyze")?.text).toContain("Seven files.");
    // and nothing else of the spec
    expect(specPhaseFile(dir, "analyze")?.text).not.toContain("Approach 1.");
  });

  test("review-plan shows only the Plan review section of 3-solution.md (criterion 6)", () => {
    const phase = specPhaseFile(dir, "review-plan");
    expect(phase?.label).toContain("3-solution.md");
    expect(phase?.label).toContain("Plan review");
    expect(phase?.text).toBe("One must-fix, five should-fix.");
    expect(phase?.text).not.toContain("Approach 1.");
    expect(phase?.text).not.toContain("Medium.");
  });

  test("implement shows 4-status.md (criterion 7)", () => {
    expect(specPhaseFile(dir, "implement")?.label).toBe("4-status.md");
    expect(specPhaseFile(dir, "implement")?.text).toContain("Phase 1: RED");
  });

  test("a step that writes no file of its own has nothing to show", () => {
    expect(specPhaseFile(dir, "resolve")).toBeNull();
    expect(specPhaseFile(dir, "")).toBeNull();
  });

  test("a phase whose file is not written yet keeps its name and says nothing was written", () => {
    const empty = mkdtempSync(join(tmpdir(), "aide-phase-empty-"));
    expect(specPhaseFile(empty, "analyze")).toEqual({ label: "2-analysis.md", text: null });
    rmSync(empty, { recursive: true, force: true });
  });

  // Criterion 8. `archive` is the one phase whose answer is not a whole
  // file: it either moved the folder or declined to, and the two must
  // never both be on the page.
  describe("archive shows one of its two outcomes, never both", () => {
    test("a spec held back shows the reason", () => {
      const held = mkdtempSync(join(tmpdir(), "aide-phase-held-"));
      writeFileSync(
        join(held, "4-status.md"),
        `${STATUS_HEAD}\n## Archive held back\n\n- the Slack webhook (Phase 4, still unchecked)\n`,
      );
      const phase = specPhaseFile(held, "archive");
      expect(phase?.text).toContain("the Slack webhook (Phase 4, still unchecked)");
      expect(phase?.text).not.toContain("Archived:");
      rmSync(held, { recursive: true, force: true });
    });

    test("a spec that was archived shows the stamp", () => {
      const done = mkdtempSync(join(tmpdir(), "aide-phase-done-"));
      writeFileSync(join(done, "4-status.md"), `${STATUS_HEAD}\n**Archived:** 2026-08-21\n`);
      const phase = specPhaseFile(done, "archive");
      expect(phase?.text).toContain("2026-08-21");
      expect(phase?.text).not.toContain("held back");
      rmSync(done, { recursive: true, force: true });
    });

    // A folder that MOVED is archived whatever an earlier attempt wrote,
    // so the stamp is the later fact and the one that is shown.
    test("a file carrying both shows the stamp alone", () => {
      const both = mkdtempSync(join(tmpdir(), "aide-phase-both-"));
      writeFileSync(
        join(both, "4-status.md"),
        `${STATUS_HEAD}\n## Archive held back\n\n- the Slack webhook\n\n**Archived:** 2026-08-21\n`,
      );
      const phase = specPhaseFile(both, "archive");
      expect(phase?.text).toContain("2026-08-21");
      expect(phase?.text).not.toContain("Slack webhook");
      rmSync(both, { recursive: true, force: true });
    });

    test("an archive that has run neither way says nothing was written", () => {
      expect(specPhaseFile(dir, "archive")).toEqual({ label: "4-status.md", text: null });
    });
  });
});

// Spec 163: the archive listing needs a DATE per row, and `4-status.md`
// carries one for every spec the archive step stamped. A second reader
// of the same line as `specPhaseFile`'s, deliberately: that one returns
// the whole line for a phase panel to show, this one returns the value
// for a listing to sort on, and neither shape serves the other's
// caller.
describe("specArchivedDate", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aide-archived-date-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const withStatus = (name: string, text: string): string => {
    const d = join(dir, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "4-status.md"), text);
    return d;
  };

  test("reads the stamp the archive step wrote", () => {
    const d = withStatus("plain", "# Status\n\n**Archived:** 2026-08-20\n");
    expect(specArchivedDate(d)).toBe("2026-08-20");
  });

  // Both shapes are on disk in aide's own archive today: the newer
  // template writes it as a Tracking-info bullet, in backticks.
  test("reads it as a Tracking info bullet, backticks and all", () => {
    const d = withStatus("bullet", "# Status\n\n## Tracking info\n\n- **Archived:** `2026-08-21`\n");
    expect(specArchivedDate(d)).toBe("2026-08-21");
  });

  test("a status file with no stamp answers null, not a blank string", () => {
    const d = withStatus("nostamp", "# Status\n\n## Tracking info\n\n- **Created:** 2026-08-01\n");
    expect(specArchivedDate(d)).toBeNull();
  });

  test("a stamp with nothing after it is no stamp", () => {
    const d = withStatus("empty", "# Status\n\n**Archived:**\n");
    expect(specArchivedDate(d)).toBeNull();
  });

  test("no 4-status.md at all answers null", () => {
    expect(specArchivedDate(join(dir, "nothing-here"))).toBeNull();
  });
});
