// Spec 512: Add keeps nothing of Aide's in the project's repository. The
// description and the settings go to the dashboard's own settings file,
// and a manifest that is already there is never written to.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGitRunner } from "../../../src/git/branch-status.ts";
import { dashboardSettingsFile } from "../../../src/git/dashboard-checkout.ts";
import { addProject } from "../../../src/project/project-admin";
import { git, projectWithOrigin } from "./git-fixture.ts";

const run = createGitRunner(30_000);
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});
const fixture = (files: Record<string, string> = {}) => {
  const f = projectWithOrigin(files);
  cleanups.push(f.cleanup);
  return f;
};

describe("Add writes the dashboard's settings file, not the checkout", () => {
  test("a checkout with no manifest gets none, and the file beside the checkouts holds name and description (AC-1)", async () => {
    const f = fixture();
    const result = await addProject(run, f.projects, { name: "demo", existingPath: f.dir, description: "A demo" }, f.base);
    expect(result.ok).toBe(true);
    expect(existsSync(join(f.dir, ".aide", "project.yaml"))).toBe(false);
    const settings = readFileSync(dashboardSettingsFile(f.base, "demo"), "utf-8");
    expect(settings).toContain("name: demo");
    expect(settings).toContain("description: A demo");
  });

  test("links and code landing go to the settings file and the checkout stays clean (AC-1)", async () => {
    const f = fixture();
    await addProject(
      run,
      f.projects,
      { name: "demo", existingPath: f.dir, worktreeLinks: "node_modules", codeLanding: "pr" },
      f.base,
    );
    const settings = readFileSync(dashboardSettingsFile(f.base, "demo"), "utf-8");
    expect(settings).toContain("worktreeLinks: node_modules");
    expect(settings).toContain("codeLanding: pr");
    expect(git(f.dir, "status", "--porcelain")).not.toContain("project.yaml");
  });

  test("a tracked manifest is kept byte for byte and the links are written nowhere (AC-1)", async () => {
    const tracked = "name: demo\ntestCmd: team check\n";
    const f = fixture({ ".aide/project.yaml": tracked });
    const result = await addProject(
      run,
      f.projects,
      { name: "demo", existingPath: f.dir, worktreeLinks: "node_modules" },
      f.base,
    );
    expect(readFileSync(join(f.dir, ".aide", "project.yaml"), "utf-8")).toBe(tracked);
    expect(existsSync(dashboardSettingsFile(f.base, "demo"))).toBe(false);
    const step = result.steps.find((s) => s.step === "manifest");
    expect(step?.note).toContain("own manifest");
  });

  test("an untracked manifest seeds the settings file and is left as it was (AC-1)", async () => {
    const f = fixture();
    mkdirSync(join(f.dir, ".aide"));
    const draft = "name: demo\ndescription: drafted\ntestCmd: make check\n";
    writeFileSync(join(f.dir, ".aide", "project.yaml"), draft);
    await addProject(run, f.projects, { name: "demo", existingPath: f.dir }, f.base);
    expect(readFileSync(dashboardSettingsFile(f.base, "demo"), "utf-8")).toBe(draft);
    expect(readFileSync(join(f.dir, ".aide", "project.yaml"), "utf-8")).toBe(draft);
  });

  test("an existing settings file is not clobbered by a second Add (AC-1)", async () => {
    const f = fixture();
    mkdirSync(join(f.base, "demo"), { recursive: true });
    writeFileSync(dashboardSettingsFile(f.base, "demo"), "name: demo\ntestCmd: mine\n");
    await addProject(run, f.projects, { name: "demo", existingPath: f.dir, description: "new" }, f.base);
    expect(readFileSync(dashboardSettingsFile(f.base, "demo"), "utf-8")).toContain("testCmd: mine");
  });
});
