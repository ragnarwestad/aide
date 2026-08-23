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

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dashboardCheckoutRoot,
  dashboardSpecDir,
  dashboardSpecsRepo,
  ensureDashboardCheckout,
} from "../src/dashboard-checkout.ts";
import { createGitRunner } from "../src/branch-status.ts";
import { configValue } from "../src/discover.ts";

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

describe("dashboardSpecDir", () => {
  // What Save and Update need: the display found a spec folder in the
  // person's checkout, and the write has to happen in the dashboard's
  // own copy of that same folder.
  test("translates a spec folder from the person's specs root into the dashboard's", () => {
    const checkout = { code: "/owned/aide/code", specs: "/owned/aide/specs/aide", specsRepo: "/owned/aide/specs" };
    expect(dashboardSpecDir(checkout, "/home/dev/aide-specs/aide", "/home/dev/aide-specs/aide/205-two-checkouts")).toBe(
      "/owned/aide/specs/aide/205-two-checkouts",
    );
  });

  test("an archived spec keeps the archive/ step of its path", () => {
    const checkout = { code: "/owned/aide/code", specs: "/owned/aide/specs/aide", specsRepo: "/owned/aide/specs" };
    expect(
      dashboardSpecDir(checkout, "/home/dev/aide-specs/aide", "/home/dev/aide-specs/aide/archive/149-landing"),
    ).toBe("/owned/aide/specs/aide/archive/149-landing");
  });

  // A folder that is not under the specs root at all names nothing the
  // dashboard owns a copy of, and guessing one would send a commit into
  // a directory nobody asked about.
  test("a folder outside the specs root translates to nothing", () => {
    const checkout = { code: "/owned/aide/code", specs: "/owned/aide/specs/aide", specsRepo: "/owned/aide/specs" };
    expect(dashboardSpecDir(checkout, "/home/dev/aide-specs/aide", "/somewhere/else/205-two-checkouts")).toBeNull();
  });
});
