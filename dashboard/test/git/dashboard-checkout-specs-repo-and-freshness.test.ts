// Split out of dashboard-checkout.test.ts by theme.
//
// Spec 205: the dashboard works in checkouts of its own — see
// dashboard-checkout-clone-and-reuse.test.ts for the full background.
//
// This file covers the separate specs repository (when a project's specs
// live somewhere other than the code, and when they don't), the
// gitignored paths a run needs linked in, the checks that leave the
// person's own checkout untouched, and (spec 216's forerunner concern)
// that the dashboard's checkout keeps up with what was pushed to origin.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dashboardCheckoutRoot,
  dashboardSpecsRepo,
  ensureDashboardCheckout,
} from "../../src/git/dashboard-checkout.ts";
import { createGitRunner } from "../../src/git/branch-status.ts";
import { configValue } from "../../src/project/discover.ts";

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
  test("a project whose specs live in its own repository gets no second clone", async () => {
    const where = tmp("aide-checkout-");
    const { clone } = repoWithClone(where, "aide", {
      "README.md": "# aide\n",
      "specs/01-first/1-description.md": "# First\n",
    });
    const base = join(where, "owned");

    const result = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });

    expect(result.checkout!.specsRepo).toBe(result.checkout!.code);
    expect(result.checkout!.specs).toBe(join(result.checkout!.code, "specs"));
    expect(existsSync(dashboardSpecsRepo(base, "aide"))).toBe(false);
  });

  // Criterion 7. The specs root is a checkout too, and it is written by
  // every run — so it gets the identical treatment, for the identical
  // reason. Note the specs ROOT is a subdirectory of the specs REPO
  // here, which is how this repo itself is laid out: one specs
  // repository holding a folder per project.
  test("a separate specs repository gets a checkout of its own, and the config names it", async () => {
    const where = tmp("aide-checkout-");
    const { clone } = repoWithClone(where, "aide", { "README.md": "# aide\n" });
    const specs = repoWithClone(where, "aide-specs", { "aide/01-first/1-description.md": "# First\n" });
    const personSpecsRoot = join(specs.clone, "aide");
    mkdirSync(join(clone, ".aide"), { recursive: true });
    writeFileSync(join(clone, ".aide", "config"), `AIDE_SPECS_PATH=${personSpecsRoot}\n`);
    const base = join(where, "owned");

    const result = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });

    expect(result.ok).toBe(true);
    expect(result.checkout!.specsRepo).toBe(dashboardSpecsRepo(base, "aide"));
    expect(result.checkout!.specs).toBe(join(dashboardSpecsRepo(base, "aide"), "aide"));
    expect(existsSync(join(result.checkout!.specs, "01-first", "1-description.md"))).toBe(true);
    // The one that matters: `aide-run-spec` reads this key out of the
    // checkout it was pointed at, and a copied config would send it
    // straight back into the person's specs.
    expect(configValue(result.checkout!.code, "AIDE_SPECS_PATH")).toBe(result.checkout!.specs);
    expect(configValue(result.checkout!.code, "AIDE_SPECS_PATH")).not.toBe(personSpecsRoot);
  });

  // Criterion 9: the one setting the dashboard actually writes has to
  // reach the checkout the runner reads, not only the person's.
  test("a changed AIDE_SPECS_PATH reaches the dashboard's own config on the next call", async () => {
    const where = tmp("aide-checkout-");
    const { clone } = repoWithClone(where, "aide", { "README.md": "# aide\n" });
    const first = repoWithClone(where, "specs-one", { "aide/01-first/1-description.md": "# First\n" });
    const second = repoWithClone(where, "specs-two", { "aide/01-first/1-description.md": "# First\n" });
    mkdirSync(join(clone, ".aide"), { recursive: true });
    writeFileSync(join(clone, ".aide", "config"), `AIDE_SPECS_PATH=${join(first.clone, "aide")}\n`);
    const base = join(where, "owned");

    await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });
    writeFileSync(join(clone, ".aide", "config"), `AIDE_SPECS_PATH=${join(second.clone, "aide")}\n`);
    const after = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });

    expect(after.ok).toBe(true);
    expect(configValue(after.checkout!.code, "AIDE_SPECS_PATH")).toBe(after.checkout!.specs);
  });

  // A run's worktree carries TRACKED files only, so `worktreeLinks`
  // names the gitignored paths it symlinks in from the checkout — and a
  // fresh clone has none of them. Linked from the person's checkout
  // rather than rebuilt: they are shared between every concurrent run
  // already, and a link is not a git operation, so it is not what the
  // person's checkout was taken out of the machinery to avoid.
  test("the gitignored paths a run needs are linked into the new checkout", async () => {
    const where = tmp("aide-checkout-");
    const { clone } = repoWithClone(where, "aide", {
      "README.md": "# aide\n",
      ".aide/project.yaml": "name: aide\nworktreeLinks: .venv node_modules\n",
    });
    mkdirSync(join(clone, ".venv"), { recursive: true });
    mkdirSync(join(clone, "node_modules"), { recursive: true });
    writeFileSync(join(clone, ".venv", "marker"), "person\n");
    const base = join(where, "owned");

    const result = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });

    expect(existsSync(join(result.checkout!.code, ".venv"))).toBe(true);
    expect(existsSync(join(result.checkout!.code, "node_modules"))).toBe(true);
    expect(readFileSync(join(result.checkout!.code, ".venv", "marker"), "utf-8")).toBe("person\n");
  });

  // The one thing that cannot be worked around: with no origin there is
  // nothing to clone from. Said as a value, the way every other git
  // answer in this codebase is, so the readiness check can put it on
  // the page instead of a run failing with nobody there.
  test("a checkout with no origin is refused in words, not thrown", async () => {
    const where = tmp("aide-checkout-");
    const lonely = join(where, "aide");
    mkdirSync(lonely, { recursive: true });
    git(lonely, "init", "-q", "-b", "main");
    const base = join(where, "owned");

    const result = await ensureDashboardCheckout(run, { base, project: "aide", personDir: lonely });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("origin");
    expect(existsSync(dashboardCheckoutRoot(base, "aide"))).toBe(false);
  });

  test("the person's own checkout is left exactly as it was found", async () => {
    const where = tmp("aide-checkout-");
    const { clone } = repoWithClone(where, "aide", { "README.md": "# aide\n" });
    git(clone, "switch", "-q", "-c", "wip");
    writeFileSync(join(clone, "README.md"), "# edited by a person\n");
    const before = git(clone, "status", "--porcelain=v1", "--branch");
    const base = join(where, "owned");

    await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });

    expect(git(clone, "status", "--porcelain=v1", "--branch")).toBe(before);
    expect(readFileSync(join(clone, "README.md"), "utf-8")).toBe("# edited by a person\n");
  });
});

// Made once and never touched again: a spec written in the person's
// checkout and pushed was listed by the page — which reads THEIR
// checkout — and refused by the runner, which reads this one.
// "unknown spec: 13-woodstack-26" on a spec the reader could see
// (2026-08-23).
describe("the dashboard's checkout keeps up with origin", () => {
  test("a commit pushed after the clone is there on the next call", async () => {
    const where = tmp("aide-checkout-");
    const { origin, clone } = repoWithClone(where, "aide", { "README.md": "# aide\n" });
    const base = join(where, "owned");

    const first = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });
    expect(first.ok).toBe(true);
    const owned = first.checkout!.code;
    expect(existsSync(join(owned, "later.md"))).toBe(false);

    // Somebody else pushes — the person's own checkout, in real life.
    writeFileSync(join(clone, "later.md"), "written after the clone\n");
    git(clone, "add", "-A");
    git(clone, "-c", "user.name=T", "-c", "user.email=t@e.x", "commit", "-qm", "later");
    git(clone, "push", "-q", "origin", "main");
    expect(origin.length).toBeGreaterThan(0);

    const second = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });
    expect(second.ok).toBe(true);
    expect(second.cloned).toBe(false);
    expect(readFileSync(join(owned, "later.md"), "utf-8")).toBe("written after the clone\n");
  });
});


// The checkout's `.aide/config` used to be the person's file copied in
// first and its `AIDE_SPECS_PATH` rewritten after the specs repo's
// clone/fetch. An `aide-run-spec` starting for another job in that
// window read the person's specs path and ran archive against the
// wrong checkout (2026-09-03). The file is now written once, finished,
// through a rename — so a reader polling it never sees the person's path.
describe("the checkout's config never names the person's specs path", () => {
  test("a reader polling .aide/config throughout ensureDashboardCheckout sees only the dashboard's path", async () => {
    const where = tmp("aide-checkout-atomic-");
    const specsRepo = repoWithClone(where, "aide-specs", { "aide/01-first/1-description.md": "# First\n" });
    const { clone } = repoWithClone(where, "aide", { "README.md": "# aide\n" });
    const personSpecs = join(specsRepo.clone, "aide");
    mkdirSync(join(clone, ".aide"), { recursive: true });
    writeFileSync(join(clone, ".aide", "config"), `AIDE_INSTALL_CMD=true\nAIDE_SPECS_PATH=${personSpecs}\n`);
    const base = join(where, "owned");
    const code = dashboardCheckoutRoot(base, "aide");

    const seen = new Set<string>();
    let stop = false;
    const poll = (async () => {
      while (!stop) {
        const v = configValue(code, "AIDE_SPECS_PATH");
        if (v) seen.add(v);
        await Bun.sleep(1);
      }
    })();
    // Twice: the first call clones, the second brings up to date — the
    // window existed on both paths.
    const first = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });
    const second = await ensureDashboardCheckout(run, { base, project: "aide", personDir: clone });
    stop = true;
    await poll;

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(seen.has(personSpecs)).toBe(false);
    expect(configValue(code, "AIDE_SPECS_PATH")).toBe(second.checkout!.specs);
    expect(configValue(code, "AIDE_INSTALL_CMD")).toBe("true");
    expect(existsSync(join(code, ".aide")) && readFileSync(join(code, ".aide", "config"), "utf-8")).not.toContain(personSpecs);
  });
});
