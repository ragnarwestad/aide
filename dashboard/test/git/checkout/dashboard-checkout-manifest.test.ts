// Spec 512: a project keeps nothing of Aide's in its repository. The
// dashboard's own settings file reaches the dashboard's clone as a
// derived, git-ignored `.aide/project.yaml`, and a manifest the team
// tracks always wins over it.
//
// Real git and a real bare origin: what is under test is what git makes
// of a working tree, and a fake would answer whatever the code asked.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitRunner } from "../../../src/git/branch-status.ts";
import { dashboardCheckoutRoot, dashboardSettingsFile, ensureDashboardCheckout } from "../../../src/git/dashboard-checkout.ts";
import { resolveCodeLanding, resolveTestCmd, resolveWorktreeLinks } from "../../../src/project/discover";

const run = createGitRunner(30_000);
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString()}`);
  return out.stdout.toString();
}

const SETTINGS = "name: demo\ntestCmd: make check\nworktreeLinks: node_modules\ncodeLanding: pr\n";

/** A bare origin with one commit, the person's checkout of it, and an
 *  empty checkout base. */
function world(files: Record<string, string> = { "README.md": "hi\n" }) {
  const root = mkdtempSync(join(tmpdir(), "aide-manifest-carry-"));
  dirs.push(root);
  const origin = join(root, "origin.git");
  const seed = join(root, "seed");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  mkdirSync(seed);
  git(seed, "init", "-q", "-b", "main");
  git(seed, "config", "user.email", "t@example.com");
  git(seed, "config", "user.name", "T");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(seed, path, ".."), { recursive: true });
    writeFileSync(join(seed, path), text);
  }
  git(seed, "add", "-A");
  git(seed, "commit", "-qm", "first");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "-q", "origin", "main");
  const personDir = join(root, "person");
  git(root, "clone", "-q", origin, personDir);
  const base = join(root, "checkouts");
  mkdirSync(join(base, "demo"), { recursive: true });
  const ensure = () => ensureDashboardCheckout(run, { base, project: "demo", personDir });
  const push = (path: string, text: string) => {
    mkdirSync(join(seed, path, ".."), { recursive: true });
    writeFileSync(join(seed, path), text);
    git(seed, "add", "-A");
    git(seed, "commit", "-qm", `add ${path}`);
    git(seed, "push", "-q", "origin", "main");
  };
  return { base, personDir, origin, code: dashboardCheckoutRoot(base, "demo"), settings: dashboardSettingsFile(base, "demo"), ensure, push };
}

describe("the dashboard's clone carries the settings file", () => {
  test("the resolvers answer the settings file and the clone stays clean (AC-4)", async () => {
    const saved = process.env.AIDE_TEST_CMD;
    delete process.env.AIDE_TEST_CMD;
    try {
      const w = world();
      writeFileSync(w.settings, SETTINGS);
      expect((await w.ensure()).ok).toBe(true);
      expect(resolveTestCmd(w.code).value).toBe("make check");
      expect(resolveWorktreeLinks(w.code).links).toBe("node_modules");
      expect(resolveCodeLanding(w.code)).toBe("pr");
      expect(git(w.code, "status", "--porcelain")).not.toContain(".aide/project.yaml");
    } finally {
      if (saved !== undefined) process.env.AIDE_TEST_CMD = saved;
    }
  });

  test("aide_manifest_get reads the same three values off the clone (AC-4)", async () => {
    const w = world();
    writeFileSync(w.settings, SETTINGS);
    await w.ensure();
    const get = (key: string) =>
      Bun.spawnSync({
        cmd: ["bash", "-c", 'source "$1"; aide_manifest_get "$2" "$3"', "_", join(import.meta.dir, "../../../../core/scripts/_aide-spec-lib.sh"), key, w.code],
        stdout: "pipe",
      }).stdout.toString().trim();
    expect(get("testCmd")).toBe("make check");
    expect(get("worktreeLinks")).toBe("node_modules");
    expect(get("codeLanding")).toBe("pr");
  });

  test("a tracked manifest wins and nothing of it is touched (AC-4)", async () => {
    const tracked = "name: demo\ntestCmd: team check\n";
    const w = world({ "README.md": "hi\n", ".aide/project.yaml": tracked });
    writeFileSync(w.settings, SETTINGS);
    await w.ensure();
    expect(readFileSync(join(w.code, ".aide/project.yaml"), "utf-8")).toBe(tracked);
    expect(readFileSync(w.settings, "utf-8")).toBe(SETTINGS);
    expect(git(w.code, "status", "--porcelain")).not.toContain("project.yaml");
  });

  test("the fast-forward over the derived copy succeeds when the team adds a manifest (AC-4)", async () => {
    const w = world();
    writeFileSync(w.settings, SETTINGS);
    await w.ensure();
    w.push(".aide/project.yaml", "name: demo\ntestCmd: team check\n");
    await w.ensure();
    expect(readFileSync(join(w.code, ".aide/project.yaml"), "utf-8")).toBe("name: demo\ntestCmd: team check\n");
    expect(git(w.code, "ls-files", ".aide/project.yaml").trim()).toBe(".aide/project.yaml");
  });

  test("the fast-forward over a legacy copy nobody excluded succeeds (AC-4)", async () => {
    const w = world();
    await w.ensure();
    writeFileSync(join(w.code, ".aide/project.yaml"), "name: demo\n");
    w.push(".aide/project.yaml", "name: demo\ntestCmd: team check\n");
    await w.ensure();
    expect(readFileSync(join(w.code, ".aide/project.yaml"), "utf-8")).toBe("name: demo\ntestCmd: team check\n");
  });

  test("worktree links are made in the clone on its first ensure (AC-4)", async () => {
    const w = world();
    mkdirSync(join(w.personDir, "node_modules"));
    writeFileSync(w.settings, SETTINGS);
    await w.ensure();
    expect(existsSync(join(w.code, "node_modules"))).toBe(true);
  });

  test("an untracked manifest in the person's checkout seeds the settings file and is left alone (AC-1)", async () => {
    const w = world();
    mkdirSync(join(w.personDir, ".aide"));
    writeFileSync(join(w.personDir, ".aide/project.yaml"), "name: demo\ntestCmd: from draft\n");
    await w.ensure();
    expect(readFileSync(w.settings, "utf-8")).toBe("name: demo\ntestCmd: from draft\n");
    expect(readFileSync(join(w.personDir, ".aide/project.yaml"), "utf-8")).toBe("name: demo\ntestCmd: from draft\n");
    expect(resolveTestCmd(w.code).value).toBe("from draft");
  });

  test("nothing is written into a person's checkout that links to the clone (AC-1)", async () => {
    const w = world();
    writeFileSync(w.settings, SETTINGS);
    await w.ensure();
    const link = join(w.base, "linked");
    symlinkSync(w.code, link);
    await ensureDashboardCheckout(run, { base: w.base, project: "demo", personDir: link });
    expect(git(w.personDir, "status", "--porcelain").trim()).toBe("");
  });
});
