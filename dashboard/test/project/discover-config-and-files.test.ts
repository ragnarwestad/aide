// Split out of discover.test.ts by theme.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SPEC_FILES, configValue, discoverUnclaimedDirectories, gitignoreCandidates, markdownSection,
  resolveInstallCmd, resolveTestCmd, specFileText,
} from "../../src/project/discover.ts";

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

// Spec 345: AIDE_INSTALL_CMD/installCmd and AIDE_TEST_CMD/testCmd are each
// readable from EITHER file, `.aide/config` winning when both set a value
// — the reverse of resolveWorktreeLinks' manifest-wins precedence, because
// an install/test command can legitimately differ per machine.
describe("resolveInstallCmd / resolveTestCmd", () => {
  const CASES = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "..", "..", "tests", "fixtures", "config-cmd-precedence.json"), "utf-8"),
  );

  const project = (configLine: string | null, manifestLine: string | null, manifestKey: string, configKey: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "aide-cmd-precedence-"));
    mkdirSync(join(dir, ".aide"), { recursive: true });
    if (configLine !== null) writeFileSync(join(dir, ".aide", "config"), `${configKey}=${configLine}\n`);
    if (manifestLine !== null) writeFileSync(join(dir, ".aide", "project.yaml"), `name: x\n${manifestKey}: ${manifestLine}\n`);
    return dir;
  };

  for (const c of CASES.cases) {
    test(`installCmd ${c.name}`, () => {
      const dir = project(c.config, c.manifest, "installCmd", "AIDE_INSTALL_CMD");
      const result = resolveInstallCmd(dir);
      expect(result.value).toBe(c.value);
      expect(result.source).toBe(c.source);
    });
    test(`testCmd ${c.name}`, () => {
      const dir = project(c.config, c.manifest, "testCmd", "AIDE_TEST_CMD");
      const result = resolveTestCmd(dir);
      expect(result.value).toBe(c.value);
      expect(result.source).toBe(c.source);
    });
  }
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

// `markdownSection` is the rule `specDescription` has always used to
// find one section of a file: to the next heading or the next `---`,
// and no markdown parser. `specPhaseFile` no longer uses it for a
// step's own page since spec 181 (the `review-plan` phase that used to
// slice one section of 3-solution.md is gone — `analyze` shows the
// whole file now), but the function itself is still exercised directly
// here.
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
