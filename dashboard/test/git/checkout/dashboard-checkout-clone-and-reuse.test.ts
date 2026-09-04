// Split out of dashboard-checkout.test.ts by theme.
//
// Spec 205: the dashboard works in checkouts of its own.
//
// A run used to be cut from the same checkout a person edits, and the
// two collided: on 2026-08-23 three specs were archived with their code
// stranded on a branch because edits made in that checkout met what two
// runs were landing from it. The machinery gets its own clone here, and
// these tests are about the four things that clone has to get right —
// it is cloned from the person's `origin`, it is cloned ONCE, it
// carries the personal `.aide/config` a clone can never bring with it,
// and its `AIDE_SPECS_PATH` names ITS OWN specs, never the person's.
//
// Real git, not `fakeGit`: what is under test is a clone, a remote and
// a working tree, and a fake that answers "clone: ok" would prove only
// that the code asked for one.
//
// This file covers the first-use clone, reuse on a second call, and
// recovery from a checkout left half-made by an interrupted clone.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dashboardCheckoutRoot,
  dashboardSpecsRepo,
  ensureDashboardCheckout,
} from "../../../src/git/dashboard-checkout.ts";
import { createGitRunner } from "../../../src/git/branch-status.ts";
import { configValue } from "../../../src/project/discover.ts";

const run = createGitRunner();
const dirs: string[] = [];
const tmp = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString()}`);
  return out.stdout.toString();
}

/** A bare origin with one commit, and a clone of it standing in for the
 *  checkout a person edits. `files` is what the repository contains. */
function repoWithClone(where: string, name: string, files: Record<string, string>): { origin: string; clone: string } {
  const seed = join(where, `${name}-seed`);
  mkdirSync(seed, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(seed, path).replace(/\/[^/]+$/, ""), { recursive: true });
    writeFileSync(join(seed, path), text);
  }
  git(seed, "init", "-q", "-b", "main");
  git(seed, "config", "user.name", "Test");
  git(seed, "config", "user.email", "test@example.com");
  git(seed, "add", "-A");
  git(seed, "commit", "-qm", "first");
  const origin = join(where, `${name}.git`);
  Bun.spawnSync({ cmd: ["git", "clone", "-q", "--bare", seed, origin] });
  const clone = join(where, name);
  Bun.spawnSync({ cmd: ["git", "clone", "-q", origin, clone] });
  return { origin, clone };
}

describe("ensureDashboardCheckout", () => {
  test("clones from the person-facing checkout's origin on first use", async () => {
    const where = tmp("aide-checkout-");
    const { clone } = repoWithClone(where, "aide", { "README.md": "# aide\n" });
    const base = join(where, "owned");

    const result = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });

    expect(result.ok).toBe(true);
    expect(result.cloned).toBe(true);
    expect(result.checkout!.code).toBe(dashboardCheckoutRoot(base, "aide"));
    expect(existsSync(join(result.checkout!.code, ".git"))).toBe(true);
    expect(readFileSync(join(result.checkout!.code, "README.md"), "utf-8")).toBe("# aide\n");
  });

  test("a second call reuses the existing checkout without cloning again", async () => {
    const where = tmp("aide-checkout-");
    const { clone } = repoWithClone(where, "aide", { "README.md": "# aide\n" });
    const base = join(where, "owned");

    const first = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });
    // Something only THIS checkout has: if a second call re-cloned, the
    // file would be gone.
    writeFileSync(join(first.checkout!.code, "scratch.txt"), "kept\n");
    const second = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });

    expect(second.ok).toBe(true);
    expect(second.cloned).toBe(false);
    expect(second.checkout!.code).toBe(first.checkout!.code);
    expect(existsSync(join(first.checkout!.code, "scratch.txt"))).toBe(true);
  });

  // Spec 209. A clone killed part-way through leaves a `.git` holding
  // `objects` and no `HEAD` — present, but not a repository that
  // answers. Read as "already cloned", every run afterwards refused,
  // and the refusal named a missing spec, which sends a reader looking
  // in the wrong place entirely. The shape is built by hand rather than
  // by killing a real clone: what matters is what is on disk, not how
  // it got there.
  function halfMadeCheckout(dir: string): void {
    mkdirSync(join(dir, ".git", "objects"), { recursive: true });
    writeFileSync(join(dir, ".git", "objects", "pack-half"), "partial\n");
    writeFileSync(join(dir, "left-behind.txt"), "from the killed clone\n");
  }

  test("a half-made checkout is replaced on the next call", async () => {
    const where = tmp("aide-checkout-");
    const { clone } = repoWithClone(where, "aide", { "README.md": "# aide\n" });
    const base = join(where, "owned");
    halfMadeCheckout(dashboardCheckoutRoot(base, "aide"));

    const result = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });

    expect(result.ok).toBe(true);
    expect(result.cloned).toBe(true);
    // The clone really happened: the content is there, and what the
    // killed one left behind is not.
    expect(readFileSync(join(result.checkout!.code, "README.md"), "utf-8")).toBe("# aide\n");
    expect(existsSync(join(result.checkout!.code, "left-behind.txt"))).toBe(false);
    expect(existsSync(join(result.checkout!.code, ".git", "HEAD"))).toBe(true);
  });

  test("a half-made separate specs checkout is replaced on the next call", async () => {
    const where = tmp("aide-checkout-");
    const { clone } = repoWithClone(where, "aide", { "README.md": "# aide\n" });
    const specs = repoWithClone(where, "aide-specs", { "aide/01-first/1-description.md": "# First\n" });
    const personSpecsRoot = join(specs.clone, "aide");
    mkdirSync(join(clone, ".aide"), { recursive: true });
    writeFileSync(join(clone, ".aide", "config"), `AIDE_SPECS_PATH=${personSpecsRoot}\n`);
    const base = join(where, "owned");
    halfMadeCheckout(dashboardSpecsRepo(base, "aide"));

    const result = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });

    expect(result.ok).toBe(true);
    expect(result.cloned).toBe(true);
    expect(result.checkout!.specs).toBe(join(dashboardSpecsRepo(base, "aide"), "aide"));
    expect(existsSync(join(result.checkout!.specs, "01-first", "1-description.md"))).toBe(true);
    expect(existsSync(join(result.checkout!.specsRepo, "left-behind.txt"))).toBe(false);
  });

  // Requirement 3: a replacement that fails says which checkout and
  // why. The one thing it must never do is report success, because the
  // next thing a reader sees then is `aide-run-spec` refusing an
  // "unknown spec" — a message about the wrong thing entirely.
  test("a half-made checkout that cannot be re-cloned says which one and why", async () => {
    const where = tmp("aide-checkout-");
    const { clone } = repoWithClone(where, "aide", { "README.md": "# aide\n" });
    git(clone, "remote", "set-url", "origin", join(where, "no-such-origin.git"));
    const base = join(where, "owned");
    const code = dashboardCheckoutRoot(base, "aide");
    halfMadeCheckout(code);

    const result = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });

    expect(result.ok).toBe(false);
    expect(result.error).toContain(code);
    expect(result.error).not.toContain("unknown spec");
  });

  // Criterion 3, and the whole of the description's disk-use
  // requirement: one more copy per PROJECT, not one per run. Counted as
  // directories rather than compared as paths — a path equality would
  // pass just as well if a second checkout sat beside the first.
  test("many runs against one project leave exactly one checkout for it", async () => {
    const where = tmp("aide-checkout-");
    const { clone } = repoWithClone(where, "aide", { "README.md": "# aide\n" });
    const base = join(where, "owned");

    for (let i = 0; i < 3; i++) {
      await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });
    }

    expect(readdirSync(base)).toEqual(["aide"]);
    expect(readdirSync(join(base, "aide"))).toEqual(["code"]);
  });

  // `.aide/config` is personal and gitignored, so a clone arrives
  // without one at all — and the runner reads `AIDE_INSTALL_CMD` and
  // the rest out of exactly that file. Copied at CREATION time, which
  // is the only moment the dashboard has anything to copy.
  test("the personal .aide/config is copied into the new checkout", async () => {
    const where = tmp("aide-checkout-");
    const { clone } = repoWithClone(where, "aide", { "README.md": "# aide\n" });
    mkdirSync(join(clone, ".aide"), { recursive: true });
    writeFileSync(join(clone, ".aide", "config"), "AIDE_INSTALL_CMD=deploy/install.sh\n");
    const base = join(where, "owned");

    const result = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });

    expect(configValue(result.checkout!.code, "AIDE_INSTALL_CMD")).toBe("deploy/install.sh");
  });
});
