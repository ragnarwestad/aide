import { dashboardSettingsFile } from "../../../src/git/dashboard-checkout.ts";
import { tmpdir } from "node:os";
// Writing .aide/config: what a save accepts, what it refuses, and what
// it leaves alone.
//
// Split out of readiness-and-config.test.ts 2026-09-04; the tests are
// unchanged and keep their names.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { addProject } from "../../../src/project/project-admin";
import { configValue, resolveWorktreeLinks } from "../../../src/project/discover";
import { cloningGit } from "../../helpers/fake-git.ts";

const dirs: string[] = [];
const root = (): string => {
  const d = mkdtempSync(join(tmpdir(), "aide-project-admin-"));
  dirs.push(d);
  return d;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});


// --- spec 138: whether a run can actually start there -------------------------
//
// Adding a project answered "added" and nothing else. Skjer was added on
// 2026-08-20 and looked added: it was on the allowlist, its checkout was
// where the form said, and a minimal manifest had been written for it.
// A run there refused before it started — the checkout stood on a
// feature branch whose upstream was gone, no specs root had been named,
// and no worktree links were configured, so the project's own test command
// would have failed for a reason that had nothing to do with the change.
// (Its untracked `.aide/` was a fourth refusal then; spec 144 removed
// that one from the runner, and this preflight with it.)
//
// None of that was visible until Run was pressed. So the answer now says
// both things: registration completed, AND whether `aide-run-spec` would
// start. The rules mirrored here are the runner's own, read-only: nothing
// below switches a branch, commits a file or creates a directory.

// Criterion 9: both fields land in the same personal file, and neither
// may take the other — or a hand-written key, or a comment — with it.
describe("writing .aide/config (spec 138)", () => {
  // Spec 184 moved the links out of this file and into the committed
  // manifest — so what this asserts now is that the value still comes
  // back in the shape the runner reads, from wherever it is kept.
  test("worktree links are written in the format the runner reads them in", async () => {
    const projectsRoot = root();
    const base = root();
    const dir = join(projectsRoot, "links");
    const result = await addProject(cloningGit().run, projectsRoot, {
      name: "links",
      gitUrl: "git@example.com:me/links.git",
      worktreeLinks: ".venv dashboard/node_modules",
    }, base);
    expect(result.ok).toBe(true);
    expect(resolveWorktreeLinks(dir, dashboardSettingsFile(base, "links")).links).toBe(".venv dashboard/node_modules");
  });

  test("both fields at once, over a config that already has comments and other keys", async () => {
    const projectsRoot = root();
    const base = root();
    const dir = join(projectsRoot, "both");
    const result = await addProject(
      cloningGit({}, { ".aide/config": "# personal — kept out of git\nAIDE_INSTALL_CMD=./install.sh\n" }).run,
      projectsRoot,
      {
      name: "both",
      gitUrl: "git@example.com:me/both.git",
      specsPath: "/repos/aide-specs/both",
      worktreeLinks: ".venv",
      },
      base,
    );
    expect(result.ok).toBe(true);
    const settingsFile = dashboardSettingsFile(base, "both");
    const text = readFileSync(join(dir, ".aide", "config"), "utf-8");
    expect(text).toContain("# personal — kept out of git");
    expect(configValue(dir, "AIDE_INSTALL_CMD")).toBe("./install.sh");
    expect(configValue(dir, "AIDE_SPECS_PATH")).toBe("/repos/aide-specs/both");
    expect(resolveWorktreeLinks(dir, settingsFile).source).toBe("project.yaml");
    // Once each: two lines for one key is a file whose meaning depends
    // on which reader you ask.
    expect(text.match(/^AIDE_SPECS_PATH=/gm)!.length).toBe(1);
    expect(
      readFileSync(settingsFile, "utf-8").match(/^worktreeLinks:/gm)!.length,
    ).toBe(1);
  });

  test("an unusable worktree-links value is refused before it is written", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "refused");
    const result = await addProject(cloningGit().run, projectsRoot, {
      name: "refused",
      gitUrl: "git@example.com:me/refused.git",
      worktreeLinks: "/etc",
    });
    expect(result.ok).toBe(false);
    const step = result.steps.find((s) => s.step === "worktreeLinks")!;
    expect(step.ok).toBe(false);
    expect(step.error).toContain("/etc");
    expect(existsSync(join(dir, ".aide", "config"))).toBe(false);
  });

  test("a worktree-links value naming a build output is refused before it is written", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "buildrefused");
    const result = await addProject(cloningGit({}, { "build/": "" }).run, projectsRoot, {
      name: "buildrefused",
      gitUrl: "git@example.com:me/buildrefused.git",
      worktreeLinks: "build",
    });
    expect(result.ok).toBe(false);
    const step = result.steps.find((s) => s.step === "worktreeLinks")!;
    expect(step.ok).toBe(false);
    expect(step.error).toContain("build");
    expect(step.error).toContain("build output");
    expect(existsSync(join(dir, ".aide", "config"))).toBe(false);
  });

  test("no worktree links means no key is written for them", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "quiet");
    await addProject(cloningGit().run, projectsRoot, {
      name: "quiet",
      gitUrl: "git@example.com:me/quiet.git",
      specsPath: "/somewhere",
    });
    expect(configValue(dir, "AIDE_WORKTREE_LINKS")).toBeNull();
  });
});
